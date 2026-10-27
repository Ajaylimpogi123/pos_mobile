<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Setting;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->branch->forceFill(['address' => "123 Rizal St.\r\nMakati City\n", 'tin' => '000-123-456-000'])->save();

    Carbon::setTestNow('2026-09-25 02:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->token = tokenFor($this->manager);
});

afterEach(function () {
    Carbon::setTestNow();
});

function getSettings(?string $token = null): TestResponse
{
    return test()->withToken($token ?? test()->token)->getJson('/api/v1/admin/settings');
}

function patchSettings(array $body, ?string $token = null): TestResponse
{
    return test()->withToken($token ?? test()->token)->patchJson('/api/v1/admin/settings', $body);
}

describe('auth', function () {
    it('returns 401 without a token', function (string $method) {
        $this->json($method, '/api/v1/admin/settings', ['receipt_copies' => 2])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    })->with(['GET', 'PATCH']);

    it('returns 403 for a cashier and writes nothing', function (string $method) {
        $this->withToken(tokenFor(userWithRole('cashier')))
            ->json($method, '/api/v1/admin/settings', ['receipt_copies' => 2])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        expect(Setting::query()->count())->toBe(0)
            ->and(AuditLog::query()->count())->toBe(0);
    })->with(['GET', 'PATCH']);

    it('checks the permission before validation', function () {
        patchSettings(['receipt_copies' => 99], tokenFor(userWithRole('cashier')))->assertForbidden();
    });
});

describe('show', function () {
    it('returns the defaults built from the branch, with updated_at null', function () {
        $response = getSettings()->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(branchSettingsKeys());

        $response->assertExactJson(['data' => [
            'receipt_header_lines' => ['Main Branch', '123 Rizal St.', 'Makati City', 'TIN 000-123-456-000'],
            'receipt_footer_lines' => ['This is not an official receipt.'],
            'auto_print_receipt' => true,
            'receipt_copies' => 1,
            'print_kitchen_tickets' => true,
            'dine_in_enabled' => false,
            'service_charge_bps' => 0,
            'reservation_hold_minutes' => 60,
            'updated_at' => null,
        ]]);
    });

    it('skips empty branch values in the default header', function () {
        $this->branch->forceFill(['address' => null, 'tin' => '  '])->save();

        getSettings()->assertOk()->assertJsonPath('data.receipt_header_lines', ['Main Branch']);
    });

    it('follows the branch while the header was never saved', function () {
        patchSettings(['receipt_copies' => 2])->assertOk();
        $this->branch->forceFill(['name' => 'Makati Branch', 'address' => null, 'tin' => null])->save();

        getSettings()->assertOk()->assertJsonPath('data.receipt_header_lines', ['Makati Branch']);
    });
});

describe('update', function () {
    it('saves only the keys sent, keeps the other defaults, and audits the change', function () {
        Carbon::setTestNow('2026-09-25 03:00:00');

        $response = patchSettings(['receipt_footer_lines' => ['Thank you!', 'Come again']])->assertOk();

        expect(array_keys($response->json('data')))->toBe(branchSettingsKeys());
        $response->assertExactJson(['data' => [
            'receipt_header_lines' => ['Main Branch', '123 Rizal St.', 'Makati City', 'TIN 000-123-456-000'],
            'receipt_footer_lines' => ['Thank you!', 'Come again'],
            'auto_print_receipt' => true,
            'receipt_copies' => 1,
            'print_kitchen_tickets' => true,
            'dine_in_enabled' => false,
            'service_charge_bps' => 0,
            'reservation_hold_minutes' => 60,
            'updated_at' => '2026-09-25T03:00:00Z',
        ]]);

        $setting = Setting::query()->sole();
        expect($setting->branch_id)->toBe($this->branch->id)
            ->and($setting->key)->toBe('receipt_footer_lines')
            ->and($setting->value)->toBe(['Thank you!', 'Come again'])
            ->and($setting->created_by)->toBe($this->manager->id)
            ->and($setting->updated_by)->toBe($this->manager->id);

        $audit = lastAudit('settings.updated');
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_type)->toBe($this->branch->getMorphClass())
            ->and($audit->subject_id)->toBe($this->branch->id)
            ->and(ksortDeep($audit->changes))->toBe([
                'receipt_footer_lines' => ['from' => ['This is not an official receipt.'], 'to' => ['Thank you!', 'Come again']],
            ]);

        getSettings()->assertOk()->assertJsonPath('data', $response->json('data'));
    });

    it('saves every key and audits only what changed', function () {
        patchSettings(['receipt_copies' => 2])->assertOk();

        Carbon::setTestNow('2026-09-25 04:00:00');

        patchSettings([
            'receipt_header_lines' => ['CAFE MARIA', 'Open daily'],
            'receipt_footer_lines' => [],
            'auto_print_receipt' => false,
            'receipt_copies' => 2,
            'print_kitchen_tickets' => false,
        ])->assertOk()->assertExactJson(['data' => [
            'receipt_header_lines' => ['CAFE MARIA', 'Open daily'],
            'receipt_footer_lines' => [],
            'auto_print_receipt' => false,
            'receipt_copies' => 2,
            'print_kitchen_tickets' => false,
            'dine_in_enabled' => false,
            'service_charge_bps' => 0,
            'reservation_hold_minutes' => 60,
            'updated_at' => '2026-09-25T04:00:00Z',
        ]]);

        expect(ksortDeep(lastAudit('settings.updated')->changes))->toBe(ksortDeep([
            'receipt_header_lines' => ['from' => ['Main Branch', '123 Rizal St.', 'Makati City', 'TIN 000-123-456-000'], 'to' => ['CAFE MARIA', 'Open daily']],
            'receipt_footer_lines' => ['from' => ['This is not an official receipt.'], 'to' => []],
            'auto_print_receipt' => ['from' => true, 'to' => false],
            'print_kitchen_tickets' => ['from' => true, 'to' => false],
        ]))
            ->and(AuditLog::query()->where('action', 'settings.updated')->count())->toBe(2)
            ->and(Setting::query()->count())->toBe(5);
    });

    it('writes nothing when nothing changes, so updated_at stays null', function () {
        patchSettings([
            'receipt_header_lines' => ['Main Branch', '123 Rizal St.', 'Makati City', 'TIN 000-123-456-000'],
            'auto_print_receipt' => true,
            'receipt_copies' => 1,
        ])->assertOk()->assertJsonPath('data.updated_at', null);

        patchSettings([])->assertOk()->assertJsonPath('data.updated_at', null);

        expect(Setting::query()->count())->toBe(0)
            ->and(AuditLog::query()->count())->toBe(0);
    });

    it('accepts the boundaries and ignores unknown keys', function () {
        patchSettings([
            'receipt_header_lines' => array_fill(0, 6, str_repeat('x', 48)),
            'receipt_copies' => 3,
            'paper' => 'A4',
            'branch_id' => 999,
        ])->assertOk()->assertJsonPath('data.receipt_copies', 3);

        expect(Setting::query()->pluck('key')->sort()->values()->all())->toBe(['receipt_copies', 'receipt_header_lines']);
    });

    it('rejects invalid values', function (array $body, string $field, string $message) {
        patchSettings($body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(Setting::query()->count())->toBe(0);
    })->with([
        'header not array' => [['receipt_header_lines' => 'Main'], 'receipt_header_lines', 'The receipt header lines field must be an array.'],
        'header null' => [['receipt_header_lines' => null], 'receipt_header_lines', 'The receipt header lines field must be an array.'],
        'header 7 lines' => [['receipt_header_lines' => array_fill(0, 7, 'x')], 'receipt_header_lines', 'The receipt header lines field must not have more than 6 items.'],
        'header line 49' => [['receipt_header_lines' => [str_repeat('x', 49)]], 'receipt_header_lines.0', 'The receipt_header_lines.0 field must not be greater than 48 characters.'],
        'header line empty' => [['receipt_header_lines' => ['ok', '']], 'receipt_header_lines.1', 'The receipt_header_lines.1 field is required.'],
        'header line number' => [['receipt_header_lines' => [12]], 'receipt_header_lines.0', 'The receipt_header_lines.0 field must be a string.'],
        'footer 7 lines' => [['receipt_footer_lines' => array_fill(0, 7, 'x')], 'receipt_footer_lines', 'The receipt footer lines field must not have more than 6 items.'],
        'footer line 49' => [['receipt_footer_lines' => [str_repeat('x', 49)]], 'receipt_footer_lines.0', 'The receipt_footer_lines.0 field must not be greater than 48 characters.'],
        'auto print not boolean' => [['auto_print_receipt' => 'yes'], 'auto_print_receipt', 'The auto print receipt field must be true or false.'],
        'auto print null' => [['auto_print_receipt' => null], 'auto_print_receipt', 'The auto print receipt field is required.'],
        'copies 0' => [['receipt_copies' => 0], 'receipt_copies', 'The receipt copies field must be at least 1.'],
        'copies 4' => [['receipt_copies' => 4], 'receipt_copies', 'The receipt copies field must not be greater than 3.'],
        'copies not integer' => [['receipt_copies' => 'two'], 'receipt_copies', 'The receipt copies field must be an integer.'],
        'copies null' => [['receipt_copies' => null], 'receipt_copies', 'The receipt copies field is required.'],
        'kitchen tickets not boolean' => [['print_kitchen_tickets' => 'no'], 'print_kitchen_tickets', 'The print kitchen tickets field must be true or false.'],
    ]);
});

describe('branch isolation', function () {
    it('keeps each branch settings separate', function () {
        $north = Branch::factory()->create(['code' => 'NORTH', 'name' => 'North Branch', 'address' => null, 'tin' => null]);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();

        patchSettings(['receipt_copies' => 3, 'receipt_footer_lines' => ['Main only']])->assertOk();

        getSettings(tokenFor($northManager))->assertOk()->assertExactJson(['data' => [
            'receipt_header_lines' => ['North Branch'],
            'receipt_footer_lines' => ['This is not an official receipt.'],
            'auto_print_receipt' => true,
            'receipt_copies' => 1,
            'print_kitchen_tickets' => true,
            'dine_in_enabled' => false,
            'service_charge_bps' => 0,
            'reservation_hold_minutes' => 60,
            'updated_at' => null,
        ]]);

        patchSettings(['receipt_copies' => 2], tokenFor($northManager))->assertOk();

        getSettings()->assertOk()->assertJsonPath('data.receipt_copies', 3);
        expect(Setting::query()->where('branch_id', $north->id)->pluck('value', 'key')->all())->toBe(['receipt_copies' => 2]);
    });
});
