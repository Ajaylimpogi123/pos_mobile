<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\CashMovement;
use App\Models\Category;
use App\Models\Device;
use App\Models\Product;
use App\Models\Shift;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-26.
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);

    $this->token = deviceToken($this->cashier);
    $this->device = Device::query()->sole();
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A second registered tablet of the branch, with a token for the user.
 */
function otherTabletToken(User $user): string
{
    return deviceToken($user, newUlid());
}

describe('POST /shifts', function () {
    it('opens a shift on the token\'s tablet and returns 201 with the exact Shift', function () {
        $body = shiftBody($this->cashier, ['opened_at' => '2026-09-26T00:02:00.000Z', 'opening_float_cents' => 200000]);

        $response = postShift($this->token, $body)->assertCreated();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(shiftKeys())
            ->and(array_keys($response->json('data.report')))->toBe(shiftReportKeys());

        $response->assertExactJson(['data' => [
            'ulid' => $body['ulid'],
            'status' => 'open',
            'device' => ['id' => $this->device->id, 'code' => $this->device->code],
            'opened_at' => '2026-09-26T00:02:00Z',
            'opened_by' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
            'opening_float_cents' => 200000,
            'closed_at' => null,
            'closed_by' => null,
            'counted_cash_cents' => null,
            'close_note' => null,
            'flags' => [],
            'report' => emptyShiftReport(200000),
            'synced_at' => '2026-09-26T04:00:00Z',
        ]]);

        $shift = Shift::query()->sole();
        $audit = lastAudit('shift.opened');

        expect($shift->branch_id)->toBe($this->branch->id)
            ->and($audit->actor_id)->toBe($this->cashier->id)
            ->and($audit->subject_id)->toBe($shift->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'device_id' => $this->device->id,
                'opened_at' => '2026-09-26T00:02:00Z',
                'opening_float_cents' => 200000,
            ]));
    });

    it('stores the opener named in the body, who may differ from the caller', function () {
        $data = openShift($this->token, $this->manager);

        expect($data['opened_by'])->toBe(['id' => $this->manager->id, 'name' => 'Marco Manager'])
            ->and(lastAudit('shift.opened')->actor_id)->toBe($this->manager->id);
    });

    it('converts an offset time to UTC and accepts a zero float', function () {
        $data = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-26T08:02:00+08:00', 'opening_float_cents' => 0]);

        expect($data['opened_at'])->toBe('2026-09-26T00:02:00Z')
            ->and($data['opening_float_cents'])->toBe(0);
    });

    it('returns the stored shift with 200 on a repeat, writing nothing', function () {
        $body = shiftBody($this->cashier);
        $first = postShift($this->token, $body)->assertCreated()->json('data');

        Carbon::setTestNow('2026-09-26 05:00:00');
        $again = postShift($this->token, [...$body, 'opening_float_cents' => 999])->assertOk()->json('data');

        expect($again)->toBe($first)
            ->and(Shift::query()->count())->toBe(1)
            ->and(AuditLog::query()->where('action', 'shift.opened')->count())->toBe(1);
    });

    it('returns the stored shift on a repeat even when the opener has been deactivated since', function () {
        $body = shiftBody($this->manager);
        postShift($this->token, $body)->assertCreated();

        $this->manager->forceFill(['is_active' => false])->save();

        postShift($this->token, $body)->assertOk()->assertJsonPath('data.ulid', $body['ulid']);
    });

    it('returns 409 for the ULID of another tablet\'s shift', function () {
        $ulid = openShift(otherTabletToken($this->cashier), $this->cashier)['ulid'];

        postShift($this->token, shiftBody($this->cashier, ['ulid' => $ulid]))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This shift belongs to another tablet.']);
    });

    it('returns 409 for the ULID of another branch\'s shift', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $nick = User::factory()->forBranch($north)->withRole('cashier')->create();
        $ulid = openShift(deviceToken($nick), $nick)['ulid'];

        postShift($this->token, shiftBody($this->cashier, ['ulid' => $ulid]))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This shift belongs to another tablet.']);
    });

    describe('two open shifts on one tablet', function () {
        it('auto-closes the older shift at the new shift\'s opened_at, with no count', function () {
            $old = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-25T23:00:00Z']);

            $new = openShift($this->token, $this->manager, ['opened_at' => '2026-09-26T01:00:00Z']);

            expect($new['status'])->toBe('open')
                ->and($new['flags'])->toBe([]);

            $stored = Shift::query()->where('ulid', $old['ulid'])->sole();

            expect($stored->closed_at->toIso8601ZuluString())->toBe('2026-09-26T01:00:00Z')
                ->and($stored->flags)->toBe(['auto_closed'])
                ->and($stored->closed_by)->toBeNull()
                ->and($stored->counted_cash_cents)->toBeNull();

            $shown = $this->withToken(tokenFor($this->manager))->getJson("/api/v1/shifts/{$old['ulid']}")->assertOk()->json('data');

            expect($shown)->toMatchArray([
                'status' => 'closed',
                'closed_at' => '2026-09-26T01:00:00Z',
                'closed_by' => null,
                'counted_cash_cents' => null,
                'flags' => ['auto_closed'],
            ])->and($shown['report']['variance_cents'])->toBeNull();

            $audit = lastAudit('shift.closed');

            expect($audit->subject_id)->toBe($stored->id)
                ->and($audit->actor_id)->toBe($this->manager->id)
                ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                    'auto_closed' => true,
                    'closed_at' => '2026-09-26T01:00:00Z',
                    'counted_cash_cents' => null,
                    'expected_cash_cents' => 200000,
                    'variance_cents' => null,
                ]));
        });

        it('auto-closes the new shift when the one already open was opened later (Q-012)', function () {
            $later = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-26T02:00:00Z']);

            $earlier = postShift($this->token, shiftBody($this->cashier, ['opened_at' => '2026-09-26T01:00:00Z']))
                ->assertCreated()
                ->json('data');

            expect($earlier)->toMatchArray([
                'status' => 'closed',
                'closed_at' => '2026-09-26T02:00:00Z',
                'flags' => ['auto_closed'],
            ])->and(Shift::query()->where('ulid', $later['ulid'])->sole()->isOpen())->toBeTrue();
        });

        it('leaves the other tablets\' open shifts alone', function () {
            $other = openShift(otherTabletToken($this->cashier), $this->cashier);

            openShift($this->token, $this->cashier);

            expect(Shift::query()->where('ulid', $other['ulid'])->sole()->isOpen())->toBeTrue();
        });
    });

    it('returns 401 without a token', function () {
        $this->flushHeaders()->postJson('/api/v1/shifts', shiftBody($this->cashier))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 403 without shift.open, before the device check', function () {
        $auditor = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('auditor', ['report.view', 'shift.close'])->id]);

        postShift(tokenFor($auditor), shiftBody($auditor))
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 409 when the token is not bound to a device, before validation', function () {
        postShift(tokenFor($this->cashier), [])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);

        expect(Shift::query()->count())->toBe(0);
    });

    it('requires every field', function () {
        postShift($this->token, [])->assertUnprocessable()->assertJsonValidationErrors([
            'ulid' => 'The ulid field is required.',
            'opened_at' => 'The opened at field is required.',
            'opened_by' => 'The opened by field is required.',
            'opening_float_cents' => 'The opening float cents field is required.',
        ]);
    });

    it('validates the fields', function (string $field, mixed $value, string $message) {
        postShift($this->token, shiftBody($this->cashier, [$field => $value]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(Shift::query()->count())->toBe(0);
    })->with([
        'ulid lowercase' => ['ulid', strtolower(newUlid()), 'The ulid field format is invalid.'],
        'opened_at not ISO' => ['opened_at', '2026-09-26 08:00:00', 'The opened at field format is invalid.'],
        'opened_at no offset' => ['opened_at', '2026-09-26T08:00:00', 'The opened at field format is invalid.'],
        'opened_by not an integer' => ['opened_by', 'carla', 'The opened by field must be an integer.'],
        'opened_by unknown' => ['opened_by', 999999, 'The selected opened by is invalid.'],
        'float as a string' => ['opening_float_cents', '200000', 'The opening float cents field must be an integer.'],
        'float negative' => ['opening_float_cents', -1, 'The opening float cents field must be at least 0.'],
        'float too large' => ['opening_float_cents', 100000001, 'The opening float cents field must not be greater than 100000000.'],
    ]);

    it('rejects an opener who is not an active user of the branch', function (Closure $opener) {
        postShift($this->token, shiftBody($opener()))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['opened_by' => 'The selected opened by is invalid.']);
    })->with([
        'inactive' => [fn () => userWithRole('cashier', ['is_active' => false])],
        'deleted' => [fn () => tap(userWithRole('cashier'))->delete()],
        'another branch' => [fn () => User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create()],
    ]);
});

describe('POST /shifts/{ulid}/cash-movements', function () {
    beforeEach(function () {
        $this->shift = openShift($this->token, $this->cashier);
    });

    it('records cash in and returns 201 with the exact CashMovement', function () {
        $body = cashMovementBody($this->cashier, ['occurred_at' => '2026-09-26T03:10:00Z']);

        $response = postCashMovement($this->token, $this->shift['ulid'], $body)->assertCreated();

        $response->assertExactJson(['data' => [
            'ulid' => $body['ulid'],
            'type' => 'in',
            'amount_cents' => 50000,
            'reason' => 'Change fund top-up',
            'occurred_at' => '2026-09-26T03:10:00Z',
            'user' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
        ]]);

        $movement = CashMovement::query()->sole();
        $audit = lastAudit('shift.cash_in');

        expect($movement->shift_ulid)->toBe($this->shift['ulid'])
            ->and($movement->branch_id)->toBe($this->branch->id)
            ->and($audit->actor_id)->toBe($this->cashier->id)
            ->and($audit->subject_type)->toBe((new Shift)->getMorphClass())
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'movement_ulid' => $body['ulid'],
                'amount_cents' => 50000,
                'reason' => 'Change fund top-up',
                'occurred_at' => '2026-09-26T03:10:00Z',
                'after_close' => false,
            ]))
            ->and(Shift::query()->sole()->flags)->toBe([]);
    });

    it('records cash out with its own audit action', function () {
        postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($this->manager, ['type' => 'out', 'amount_cents' => 10500, 'reason' => 'Ice']))
            ->assertCreated()
            ->assertJsonPath('data.type', 'out')
            ->assertJsonPath('data.user', ['id' => $this->manager->id, 'name' => 'Marco Manager']);

        expect(lastAudit('shift.cash_out')->actor_id)->toBe($this->manager->id)
            ->and(lastAudit('shift.cash_in'))->toBeNull();
    });

    it('returns the stored movement with 200 on a repeat, writing nothing', function () {
        $body = cashMovementBody($this->cashier);
        $first = postCashMovement($this->token, $this->shift['ulid'], $body)->assertCreated()->json('data');

        $again = postCashMovement($this->token, $this->shift['ulid'], [...$body, 'amount_cents' => 1])->assertOk()->json('data');

        expect($again)->toBe($first)
            ->and(CashMovement::query()->count())->toBe(1)
            ->and(AuditLog::query()->where('action', 'shift.cash_in')->count())->toBe(1);
    });

    it('returns 422 on ulid when the ULID was used for another shift\'s movement', function () {
        $body = cashMovementBody($this->cashier);
        postCashMovement($this->token, $this->shift['ulid'], $body)->assertCreated();

        $next = openShift($this->token, $this->cashier);

        postCashMovement($this->token, $next['ulid'], $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['ulid' => 'The ulid has already been taken.']);
    });

    it('accepts a movement for a closed shift and flags it once', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->cashier, 200000))->assertOk();

        postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($this->cashier))->assertCreated();
        postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($this->cashier, ['type' => 'out', 'amount_cents' => 100]))->assertCreated();

        expect(Shift::query()->sole()->flags)->toBe(['movement_after_close'])
            ->and(lastAudit('shift.cash_in')->changes['after_close'])->toBeTrue();

        $this->withToken($this->token)->getJson("/api/v1/shifts/{$this->shift['ulid']}")
            ->assertOk()
            ->assertJsonPath('data.flags', ['movement_after_close'])
            ->assertJsonPath('data.report.cash_in_cents', 50000)
            ->assertJsonPath('data.report.cash_out_cents', 100);
    });

    it('returns 404 for a shift the branch doesn\'t know', function (Closure $ulid) {
        postCashMovement($this->token, $ulid(), cashMovementBody($this->cashier))
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    })->with([
        'unknown' => [fn () => newUlid()],
        'another branch' => [function () {
            $nick = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();

            return openShift(deviceToken($nick), $nick)['ulid'];
        }],
    ]);

    it('returns 409 for another tablet\'s shift', function () {
        postCashMovement(otherTabletToken($this->cashier), $this->shift['ulid'], cashMovementBody($this->cashier))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This shift belongs to another tablet.']);

        expect(CashMovement::query()->count())->toBe(0);
    });

    it('returns 409 without a device', function () {
        postCashMovement(tokenFor($this->cashier), $this->shift['ulid'], cashMovementBody($this->cashier))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);
    });

    it('returns 403 without shift.open', function () {
        $closer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('closer', ['shift.close'])->id]);

        postCashMovement(deviceToken($closer, newUlid()), $this->shift['ulid'], cashMovementBody($closer))
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 401 without a token', function () {
        $this->flushHeaders()->postJson("/api/v1/shifts/{$this->shift['ulid']}/cash-movements", cashMovementBody($this->cashier))
            ->assertUnauthorized();
    });

    it('requires every field', function () {
        postCashMovement($this->token, $this->shift['ulid'], [])->assertUnprocessable()->assertJsonValidationErrors([
            'ulid', 'type', 'amount_cents', 'reason', 'occurred_at', 'user_id',
        ]);
    });

    it('validates the fields', function (string $field, mixed $value, string $message) {
        postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($this->cashier, [$field => $value]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(CashMovement::query()->count())->toBe(0);
    })->with([
        'type' => ['type', 'refund', 'The selected type is invalid.'],
        'amount zero' => ['amount_cents', 0, 'The amount cents field must be at least 1.'],
        'amount as a string' => ['amount_cents', '100', 'The amount cents field must be an integer.'],
        'amount too large' => ['amount_cents', 100000001, 'The amount cents field must not be greater than 100000000.'],
        'reason empty' => ['reason', '', 'The reason field is required.'],
        'reason too long' => ['reason', str_repeat('r', 121), 'The reason field must not be greater than 120 characters.'],
        'occurred_at' => ['occurred_at', 'yesterday', 'The occurred at field format is invalid.'],
        'user unknown' => ['user_id', 999999, 'The selected user id is invalid.'],
    ]);

    it('rejects an inactive user', function () {
        $gone = userWithRole('cashier', ['is_active' => false]);

        postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($gone))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['user_id' => 'The selected user id is invalid.']);
    });
});

describe('POST /shifts/{ulid}/close', function () {
    beforeEach(function () {
        $this->shift = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-26T00:02:00Z', 'opening_float_cents' => 200000]);
    });

    it('closes the shift and returns 200 with the Z-read', function () {
        postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($this->cashier, ['amount_cents' => 5000]))->assertCreated();

        $response = postClose($this->token, $this->shift['ulid'], closeBody($this->manager, 204000, [
            'closed_at' => '2026-09-26T09:05:00Z',
            'close_note' => 'Short ₱10',
        ]))->assertOk();

        expect(array_keys($response->json('data')))->toBe(shiftKeys());

        expect($response->json('data'))->toMatchArray([
            'ulid' => $this->shift['ulid'],
            'status' => 'closed',
            'closed_at' => '2026-09-26T09:05:00Z',
            'closed_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
            'counted_cash_cents' => 204000,
            'close_note' => 'Short ₱10',
            'flags' => [],
        ])->and($response->json('data.report'))->toMatchArray([
            'cash_in_cents' => 5000,
            'expected_cash_cents' => 205000,
            'variance_cents' => -1000,
        ]);

        $audit = lastAudit('shift.closed');

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'auto_closed' => false,
                'closed_at' => '2026-09-26T09:05:00Z',
                'counted_cash_cents' => 204000,
                'expected_cash_cents' => 205000,
                'variance_cents' => -1000,
            ]));
    });

    it('keeps the first close: a second close returns the stored shift unchanged', function () {
        $first = postClose($this->token, $this->shift['ulid'], closeBody($this->cashier, 200000))->assertOk()->json('data');

        $again = postClose($this->token, $this->shift['ulid'], closeBody($this->manager, 1, ['close_note' => 'Second']))
            ->assertOk()
            ->json('data');

        expect($again)->toBe($first)
            ->and(AuditLog::query()->where('action', 'shift.closed')->count())->toBe(1);
    });

    describe('an auto-closed shift (Q-012)', function () {
        beforeEach(function () {
            // The tablet opened the next shift first: this one is auto-closed at 03:00, uncounted.
            openShift($this->token, $this->cashier, ['opened_at' => '2026-09-26T03:00:00Z']);
            postCashMovement($this->token, $this->shift['ulid'], cashMovementBody($this->cashier, ['amount_cents' => 5000]))->assertCreated();
        });

        it('records the count, note, closer and the body\'s close time, keeping auto_closed', function () {
            $data = postClose($this->token, $this->shift['ulid'], closeBody($this->manager, 204000, [
                'closed_at' => '2026-09-26T02:55:00Z',
                'close_note' => 'Counted late',
            ]))->assertOk()->json('data');

            expect($data)->toMatchArray([
                'status' => 'closed',
                'closed_at' => '2026-09-26T02:55:00Z',
                'closed_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
                'counted_cash_cents' => 204000,
                'close_note' => 'Counted late',
                'flags' => ['auto_closed', 'movement_after_close'],
            ])->and($data['report'])->toMatchArray([
                'cash_in_cents' => 5000,
                'expected_cash_cents' => 205000,
                'variance_cents' => -1000,
            ]);

            $audit = lastAudit('shift.closed');

            expect($audit->actor_id)->toBe($this->manager->id)
                ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                    'auto_closed' => true,
                    'closed_at' => '2026-09-26T02:55:00Z',
                    'counted_cash_cents' => 204000,
                    'expected_cash_cents' => 205000,
                    'variance_cents' => -1000,
                ]))
                ->and(AuditLog::query()->where('action', 'shift.closed')->count())->toBe(2); // the auto-close and this one
        });

        it('keeps the auto-close time when the body\'s time is before the shift opened', function () {
            postClose($this->token, $this->shift['ulid'], closeBody($this->cashier, 205000, ['closed_at' => '2026-09-25T23:00:00Z']))
                ->assertOk()
                ->assertJsonPath('data.closed_at', '2026-09-26T03:00:00Z')
                ->assertJsonPath('data.counted_cash_cents', 205000)
                ->assertJsonPath('data.report.variance_cents', 0);
        });

        it('checks the closer like any close', function () {
            postClose($this->token, $this->shift['ulid'], closeBody(userWithRole('cashier', ['is_active' => false]), 0))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['closed_by' => 'The selected closed by is invalid.']);
        });

        it('keeps the first count: a later close returns the stored shift unchanged', function () {
            $first = postClose($this->token, $this->shift['ulid'], closeBody($this->cashier, 205000))->assertOk()->json('data');

            $again = postClose($this->token, $this->shift['ulid'], closeBody($this->manager, 1, ['close_note' => 'Again']))
                ->assertOk()
                ->json('data');

            expect($again)->toBe($first)
                ->and(AuditLog::query()->where('action', 'shift.closed')->count())->toBe(2);
        });
    });

    it('returns the stored shift on a repeat even when the closer has been deactivated since', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->manager, 200000))->assertOk();
        $this->manager->forceFill(['is_active' => false])->save();

        postClose($this->token, $this->shift['ulid'], closeBody($this->manager, 200000))->assertOk();
    });

    it('returns 404 for an unknown shift', function () {
        postClose($this->token, newUlid(), closeBody($this->cashier, 0))
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    });

    it('returns 409 for another tablet\'s shift', function () {
        postClose(otherTabletToken($this->cashier), $this->shift['ulid'], closeBody($this->cashier, 0))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This shift belongs to another tablet.']);

        expect(Shift::query()->sole()->isOpen())->toBeTrue();
    });

    it('returns 409 without a device', function () {
        postClose(tokenFor($this->cashier), $this->shift['ulid'], closeBody($this->cashier, 0))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);
    });

    it('returns 403 without shift.close', function () {
        $opener = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('opener', ['shift.open'])->id]);

        postClose(deviceToken($opener, newUlid()), $this->shift['ulid'], closeBody($opener, 0))
            ->assertForbidden();
    });

    it('returns 401 without a token', function () {
        $this->flushHeaders()->postJson("/api/v1/shifts/{$this->shift['ulid']}/close", closeBody($this->cashier, 0))->assertUnauthorized();
    });

    it('validates the fields', function (string $field, mixed $value, string $message) {
        postClose($this->token, $this->shift['ulid'], closeBody($this->cashier, 0, [$field => $value]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(Shift::query()->sole()->isOpen())->toBeTrue();
    })->with([
        'closed_at missing' => ['closed_at', null, 'The closed at field is required.'],
        'closed_at not ISO' => ['closed_at', '26/09/2026', 'The closed at field format is invalid.'],
        'closed_by missing' => ['closed_by', null, 'The closed by field is required.'],
        'closed_by unknown' => ['closed_by', 999999, 'The selected closed by is invalid.'],
        'count missing' => ['counted_cash_cents', null, 'The counted cash cents field is required.'],
        'count as a string' => ['counted_cash_cents', '100', 'The counted cash cents field must be an integer.'],
        'count negative' => ['counted_cash_cents', -1, 'The counted cash cents field must be at least 0.'],
        'count too large' => ['counted_cash_cents', 1000000001, 'The counted cash cents field must not be greater than 1000000000.'],
        'note too long' => ['close_note', str_repeat('n', 256), 'The close note field must not be greater than 255 characters.'],
    ]);
});

describe('GET /shifts', function () {
    it('lists the branch\'s shifts newest first, each with its report, in the cursor envelope', function () {
        $a = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-25T00:00:00Z']);
        $b = openShift(otherTabletToken($this->cashier), $this->cashier, ['opened_at' => '2026-09-26T01:00:00Z']);
        $c = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-26T02:00:00Z']);

        $nick = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();
        openShift(deviceToken($nick), $nick);

        $response = $this->withToken(tokenFor($this->manager))->getJson('/api/v1/shifts')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
            ->and($response->json('meta.per_page'))->toBe(25)
            ->and(array_column($response->json('data'), 'ulid'))->toBe([$c['ulid'], $b['ulid'], $a['ulid']])
            ->and(array_keys($response->json('data.0')))->toBe(shiftKeys())
            ->and($response->json('data.2.status'))->toBe('closed') // auto-closed by $c
            ->and($response->json('data.2.report'))->toBe(emptyShiftReport(200000));
    });

    it('pages with the cursor', function () {
        foreach (range(1, 3) as $hour) {
            openShift(otherTabletToken($this->cashier), $this->cashier, ['opened_at' => "2026-09-26T0{$hour}:00:00Z"]);
        }

        $token = tokenFor($this->manager);
        $first = $this->withToken($token)->getJson('/api/v1/shifts?per_page=2')->assertOk();
        $cursor = $first->json('meta.next_cursor');

        expect($first->json('data'))->toHaveCount(2)->and($cursor)->not->toBeNull();

        $second = $this->withToken($token)->getJson('/api/v1/shifts?per_page=2&cursor='.$cursor)->assertOk();

        expect($second->json('data'))->toHaveCount(1)
            ->and($second->json('meta.next_cursor'))->toBeNull()
            ->and($second->json('data.0.opened_at'))->toBe('2026-09-26T01:00:00Z');
    });

    it('filters by business date, device and status', function () {
        // 03:59 Manila on the 26th still belongs to business day 2026-09-25.
        $late = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-25T19:59:00Z']);
        $today = openShift($this->token, $this->cashier, ['opened_at' => '2026-09-25T20:00:00Z']);
        $other = openShift(otherTabletToken($this->cashier), $this->cashier, ['opened_at' => '2026-09-26T01:00:00Z']);

        $list = fn (string $query) => array_column(
            $this->withToken(tokenFor($this->manager))->getJson('/api/v1/shifts?'.$query)->assertOk()->json('data'),
            'ulid',
        );

        expect($list('business_date=2026-09-25'))->toBe([$late['ulid']])
            ->and($list('business_date=2026-09-26'))->toBe([$other['ulid'], $today['ulid']])
            ->and($list('device_id='.$this->device->id))->toBe([$today['ulid'], $late['ulid']])
            ->and($list('status=open'))->toBe([$other['ulid'], $today['ulid']])
            ->and($list('status=closed'))->toBe([$late['ulid']]);
    });

    it('computes every report of a page with a fixed number of queries', function () {
        $product = Product::factory()->forCategory(Category::factory()->create())->create(['price_cents' => 5000]);

        $count = function (): int {
            $token = tokenFor($this->manager);
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken($token)->getJson('/api/v1/shifts')->assertOk();
            $count = count(DB::getQueryLog());
            DB::disableQueryLog();

            return $count;
        };

        $shift = openShift($this->token, $this->cashier);
        sell($this->cashier, [[$product, 1]], ['shift_ulid' => $shift['ulid']]);
        $one = $count();

        foreach (range(1, 6) as $i) {
            $shift = openShift(otherTabletToken($this->cashier), $this->cashier);
            sell($this->manager, [[$product, 2]], ['shift_ulid' => $shift['ulid']]);
            postCashMovement(otherTabletToken($this->cashier), $shift['ulid'], cashMovementBody($this->cashier))->assertStatus(409);
        }

        // Auth + permissions, the page, its 3 relations, and the 7 report queries (Phase 7 adds
        // the voids, the refunds and the refunds by method).
        expect($count())->toBe($one)
            ->and($one)->toBeLessThanOrEqual(15);
    });
    it('validates the query', function (string $query, string $field) {
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/shifts?'.$query)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        'per_page' => ['per_page=101', 'per_page'],
        'business_date' => ['business_date=26-09-2026', 'business_date'],
        'device_id' => ['device_id=abc', 'device_id'],
        'status' => ['status=pending', 'status'],
    ]);

    it('returns 403 without report.zread', function () {
        $this->withToken($this->token)->getJson('/api/v1/shifts')
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 401 without a token', function () {
        $this->flushHeaders()->getJson('/api/v1/shifts')->assertUnauthorized();
    });
});

describe('GET /shifts/{ulid}', function () {
    beforeEach(function () {
        $this->shift = openShift($this->token, $this->cashier);
    });

    it('shows any shift of the branch with report.zread, even without a device', function () {
        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/shifts/{$this->shift['ulid']}")
            ->assertOk()
            ->assertJsonPath('data', $this->shift);
    });

    it('shows a shift of the caller\'s own tablet without report.zread', function () {
        $this->withToken($this->token)->getJson('/api/v1/shifts/'.strtolower($this->shift['ulid']))
            ->assertOk()
            ->assertJsonPath('data.ulid', $this->shift['ulid']);
    });

    it('returns 403 for another tablet\'s shift without report.zread', function () {
        $this->withToken(otherTabletToken($this->cashier))->getJson("/api/v1/shifts/{$this->shift['ulid']}")
            ->assertForbidden();

        $this->withToken(tokenFor($this->cashier))->getJson("/api/v1/shifts/{$this->shift['ulid']}")
            ->assertForbidden();
    });

    it('returns 404 for an unknown shift or another branch\'s', function () {
        $owner = User::factory()->forBranch(Branch::factory()->create())->withRole('owner')->create();

        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/shifts/'.newUlid())
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);

        $this->withToken(tokenFor($owner))->getJson("/api/v1/shifts/{$this->shift['ulid']}")->assertNotFound();
    });

    it('returns 401 without a token', function () {
        $this->flushHeaders()->getJson("/api/v1/shifts/{$this->shift['ulid']}")->assertUnauthorized();
    });
});

it('leaves shift.* audit entries out of the dashboard activity feed', function () {
    $shift = openShift($this->token, $this->cashier);
    postCashMovement($this->token, $shift['ulid'], cashMovementBody($this->cashier))->assertCreated();
    postClose($this->token, $shift['ulid'], closeBody($this->cashier, 0))->assertOk();

    $activity = $this->withToken(tokenFor($this->manager))->getJson('/api/v1/dashboard')->assertOk()->json('data.activity');

    expect(collect($activity['recent_changes'])->pluck('action')->filter(fn (string $a) => str_starts_with($a, 'shift.'))->all())->toBe([])
        // Only the device registration counts as a change.
        ->and(collect($activity['changes_by_day'])->sum('count'))->toBe(1)
        ->and(collect($activity['recent_changes'])->pluck('action')->all())->toBe(['device.registered']);
});
