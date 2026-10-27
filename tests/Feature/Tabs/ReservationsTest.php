<?php

use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\Setting;
use App\Models\Tab;
use App\Models\TableReservation;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    setDineIn($this->branch);

    // 12:00 PM in Manila, business day 2026-10-26. 11:00Z is 7:00 PM.
    Carbon::setTestNow('2026-10-26 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->owner = userWithRole('owner', ['name' => 'Olive Owner']);

    $this->t5 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'area' => 'Patio', 'seats' => 4]);
    $this->t7 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '7', 'area' => 'Patio', 'seats' => 2, 'sort_order' => 1]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A POST /reservations body for the table (override anything).
 *
 * @return array<string, mixed>
 */
function bookingBody(DiningTable $table, array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'table_id' => $table->id,
        'guest_name' => 'Santos',
        'phone' => '0917 123 4567',
        'party_size' => 4,
        'reserved_for' => '2026-10-26T11:00:00Z',
        'notes' => null,
    ], $overrides);
}

function book(User $user, DiningTable $table, array $overrides = []): TestResponse
{
    return tabRequest($user, 'POST', '/api/v1/reservations', bookingBody($table, $overrides));
}

/**
 * Book through the API and return the `Reservation` JSON.
 *
 * @return array<string, mixed>
 */
function booked(User $user, DiningTable $table, array $overrides = []): array
{
    return book($user, $table, $overrides)->assertCreated()->json('data');
}

/**
 * @return list<string>
 */
function reservationKeys(): array
{
    return [
        'ulid', 'status', 'table', 'guest_name', 'phone', 'party_size', 'reserved_for', 'business_date', 'notes',
        'is_held', 'is_late', 'tab_ulid', 'created_by', 'updated_at',
    ];
}

function setHoldMinutes(Branch $branch, int $minutes): void
{
    $setting = Setting::query()->firstOrNew(['branch_id' => $branch->id, 'key' => 'reservation_hold_minutes']);
    $setting->value = $minutes;
    $setting->save();
}

describe('auth, permissions and the dine-in gate', function () {
    it('needs a token', function () {
        $this->getJson('/api/v1/reservations')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
        $this->postJson('/api/v1/reservations', [])->assertUnauthorized();
        $this->patchJson('/api/v1/reservations/'.newUlid(), [])->assertUnauthorized();
        $this->postJson('/api/v1/reservations/'.newUlid().'/cancel', [])->assertUnauthorized();
        $this->postJson('/api/v1/reservations/'.newUlid().'/no-show', [])->assertUnauthorized();
    });

    it('needs sale.create', function () {
        $r = booked($this->carla, $this->t5);
        $viewer = userWithRole('cashier');
        $viewer->forceFill(['role_id' => customRole('viewer', ['report.view'])->id])->save();
        $denied = ['message' => 'This action is unauthorized.'];

        // Q-051: report.view reads the list (the Board) but can't change anything.
        $this->withToken(tokenFor($viewer))->getJson('/api/v1/reservations')
            ->assertOk()
            ->assertJsonPath('data.0.ulid', $r['ulid']);
        book($viewer, $this->t7)->assertForbidden()->assertExactJson($denied);
        tabRequest($viewer, 'PATCH', "/api/v1/reservations/{$r['ulid']}", ['party_size' => 2])->assertForbidden();
        tabRequest($viewer, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel")->assertForbidden();
        tabRequest($viewer, 'POST', "/api/v1/reservations/{$r['ulid']}/no-show")->assertForbidden();

        // Without either permission the list is a 403 too.
        $nobody = userWithRole('cashier');
        $nobody->forceFill(['role_id' => customRole('nobody', [])->id])->save();
        $this->withToken(tokenFor($nobody))->getJson('/api/v1/reservations')->assertForbidden()->assertExactJson($denied);
    });

    it('returns 409 on every endpoint while dine-in is off', function () {
        $r = booked($this->carla, $this->t5);
        setDineIn($this->branch, false);
        $off = ['message' => 'Dine-in tables are turned off in Settings.'];

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/reservations')->assertConflict()->assertExactJson($off);
        book($this->carla, $this->t7)->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'PATCH', "/api/v1/reservations/{$r['ulid']}", ['party_size' => 2])->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel")->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/no-show")->assertConflict()->assertExactJson($off);
    });

    it('returns 404 for another branch reservation or an unknown one', function () {
        $other = Branch::factory()->create(['code' => 'OTHER']);
        $foreign = TableReservation::factory()
            ->forTable(DiningTable::factory()->forBranch($other)->create(['name' => '5']))
            ->create(['created_by' => $this->owner->id]);
        $missing = ['message' => 'Resource not found.'];

        foreach ([$foreign->ulid, newUlid()] as $ulid) {
            tabRequest($this->carla, 'PATCH', "/api/v1/reservations/{$ulid}", ['party_size' => 2])->assertNotFound()->assertExactJson($missing);
            tabRequest($this->carla, 'POST', "/api/v1/reservations/{$ulid}/cancel")->assertNotFound();
            tabRequest($this->carla, 'POST', "/api/v1/reservations/{$ulid}/no-show")->assertNotFound();
        }
    });
});

describe('POST /reservations', function () {
    it('books a table', function () {
        $body = bookingBody($this->t5, ['party_size' => 6, 'notes' => 'Birthday']);

        $response = tabRequest($this->carla, 'POST', '/api/v1/reservations', $body)->assertCreated();

        expect(array_keys($response->json('data')))->toBe(reservationKeys())
            ->and($response->json('data'))->toMatchArray([
                'ulid' => $body['ulid'],
                'status' => 'booked',
                'table' => ['id' => $this->t5->id, 'name' => '5', 'area' => 'Patio'],
                'guest_name' => 'Santos',
                'phone' => '0917 123 4567',
                'party_size' => 6,
                'reserved_for' => '2026-10-26T11:00:00Z',
                'business_date' => '2026-10-26',
                'notes' => 'Birthday',
                'is_held' => false,
                'is_late' => false,
                'tab_ulid' => null,
                'created_by' => ['id' => $this->carla->id, 'name' => 'Carla Cashier'],
                'updated_at' => '2026-10-26T04:00:00Z',
            ])
            ->and(lastAudit('reservation.created'))->not->toBeNull();

        // The idempotent replay writes nothing.
        tabRequest($this->carla, 'POST', '/api/v1/reservations', $body)
            ->assertCreated()
            ->assertHeader('Idempotency-Replayed', 'true');

        expect(TableReservation::query()->count())->toBe(1);
    });

    it('takes the business day of the reservation time', function () {
        // 3:30 AM Manila on the 28th is still business day the 27th.
        expect(booked($this->carla, $this->t5, ['reserved_for' => '2026-10-27T19:30:00Z'])['business_date'])->toBe('2026-10-27')
            ->and(TableReservation::query()->sole()->business_date)->toBe('2026-10-27');
    });

    it('validates the fields', function () {
        book($this->carla, $this->t5, ['table_id' => null, 'guest_name' => '', 'party_size' => null, 'reserved_for' => null])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['table_id', 'guest_name', 'party_size', 'reserved_for']);

        book($this->carla, $this->t5, ['guest_name' => str_repeat('a', 61)])->assertUnprocessable()->assertJsonValidationErrors(['guest_name']);
        book($this->carla, $this->t5, ['phone' => 'call me'])->assertUnprocessable()->assertJsonValidationErrors(['phone']);
        book($this->carla, $this->t5, ['phone' => str_repeat('1', 21)])->assertUnprocessable()->assertJsonValidationErrors(['phone']);
        book($this->carla, $this->t5, ['party_size' => 0])->assertUnprocessable()->assertJsonValidationErrors(['party_size']);
        book($this->carla, $this->t5, ['party_size' => 100])->assertUnprocessable()->assertJsonValidationErrors(['party_size']);
        book($this->carla, $this->t5, ['notes' => str_repeat('a', 256)])->assertUnprocessable()->assertJsonValidationErrors(['notes']);
        book($this->carla, $this->t5, ['reserved_for' => 'tonight'])->assertUnprocessable()->assertJsonValidationErrors(['reserved_for']);

        $inactive = DiningTable::factory()->forBranch($this->branch)->inactive()->create(['name' => '8']);
        $foreign = DiningTable::factory()->forBranch(Branch::factory()->create(['code' => 'OTHER']))->create(['name' => '9']);
        book($this->carla, $inactive)->assertUnprocessable()->assertJsonValidationErrors(['table_id']);
        book($this->carla, $foreign)->assertUnprocessable()->assertJsonValidationErrors(['table_id']);

        tabRequest($this->carla, 'POST', '/api/v1/reservations', bookingBody($this->t5), newUlid())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['idempotency_key']);

        // A party larger than the table is allowed.
        book($this->carla, $this->t7, ['party_size' => 9])->assertCreated();
    });

    it('takes times from 15 minutes ago up to 90 days ahead', function () {
        $window = ['reserved_for' => 'Pick a time from now up to 90 days ahead.'];

        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T03:44:59Z'])->assertUnprocessable()->assertJsonValidationErrors($window);
        book($this->carla, $this->t5, ['reserved_for' => '2027-01-24T04:00:01Z'])->assertUnprocessable()->assertJsonValidationErrors($window);

        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T03:45:00Z'])->assertCreated();
        book($this->carla, $this->t7, ['reserved_for' => '2027-01-24T04:00:00Z'])->assertCreated();
    });

    it('refuses a booking within 120 minutes of another, in both directions', function () {
        booked($this->carla, $this->t5);
        $clash = ['reserved_for' => 'Table 5 is already reserved at 7:00 PM.'];

        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T12:59:00Z'])->assertUnprocessable()->assertJsonValidationErrors($clash);
        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T09:01:00Z'])->assertUnprocessable()->assertJsonValidationErrors($clash);
        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T11:00:00Z'])->assertUnprocessable()->assertJsonValidationErrors($clash);

        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T13:00:00Z'])->assertCreated();
        book($this->carla, $this->t5, ['reserved_for' => '2026-10-26T09:00:00Z'])->assertCreated();
        book($this->carla, $this->t7, ['reserved_for' => '2026-10-26T11:30:00Z'])->assertCreated();
    });

    it('ignores reservations that are no longer booked in the clash rule', function () {
        $r = booked($this->carla, $this->t5);
        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel")->assertOk();

        book($this->carla, $this->t5)->assertCreated();
    });

    it('locks the table row before the clash check, so two devices cannot book it at once', function () {
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = strtolower($query->sql);
        });

        book($this->carla, $this->t5)->assertCreated();

        $lock = collect($queries)->search(fn (string $sql) => str_contains($sql, 'dining_tables') && str_contains($sql, 'for update'));
        $insert = collect($queries)->search(fn (string $sql) => str_starts_with($sql, 'insert into') && str_contains($sql, 'table_reservations'));

        expect($lock)->not->toBeFalse()
            ->and($insert)->not->toBeFalse()
            ->and($lock)->toBeLessThan($insert);

        // Another device's committed booking for the same slot is seen under the lock.
        book($this->owner, $this->t5, ['reserved_for' => '2026-10-26T11:30:00Z'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reserved_for' => 'Table 5 is already reserved at 7:00 PM.']);
    });
});

describe('GET /reservations', function () {
    it('lists a business day by time, with filters, in the cursor envelope', function () {
        $late = booked($this->carla, $this->t5, ['reserved_for' => '2026-10-26T12:00:00Z']);
        $early = booked($this->carla, $this->t7, ['reserved_for' => '2026-10-26T06:00:00Z']);
        $cancelled = booked($this->carla, $this->t5, ['reserved_for' => '2026-10-26T09:00:00Z']);
        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$cancelled['ulid']}/cancel", ['reason' => 'Called'])->assertOk();
        $tomorrow = booked($this->carla, $this->t5, ['reserved_for' => '2026-10-27T11:00:00Z']);

        $other = Branch::factory()->create(['code' => 'OTHER']);
        TableReservation::factory()->forTable(DiningTable::factory()->forBranch($other)->create(), CarbonImmutable::parse('2026-10-26T08:00:00Z'))
            ->create(['created_by' => $this->owner->id]);

        $list = fn (string $query = '') => $this->withToken(tokenFor($this->carla))->getJson('/api/v1/reservations'.$query);

        $response = $list()->assertOk()->assertJsonStructure(['data', 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor']]);
        expect(array_column($response->json('data'), 'ulid'))->toBe([$early['ulid'], $cancelled['ulid'], $late['ulid']])
            ->and($response->json('meta.per_page'))->toBe(100)
            ->and(array_keys($response->json('data.0')))->toBe(reservationKeys());

        expect(array_column($list('?status=booked')->json('data'), 'ulid'))->toBe([$early['ulid'], $late['ulid']])
            ->and(array_column($list("?table_id={$this->t5->id}")->json('data'), 'ulid'))->toBe([$cancelled['ulid'], $late['ulid']])
            ->and(array_column($list('?date=2026-10-27')->json('data'), 'ulid'))->toBe([$tomorrow['ulid']]);

        $page = $list('?per_page=2')->assertOk();
        expect($page->json('data'))->toHaveCount(2)->and($page->json('meta.next_cursor'))->not->toBeNull();
        $next = $list('?per_page=2&cursor='.$page->json('meta.next_cursor'))->assertOk();
        expect(array_column($next->json('data'), 'ulid'))->toBe([$late['ulid']]);

        $list('?date=26-10-2026')->assertUnprocessable()->assertJsonValidationErrors(['date']);
        $list('?status=gone')->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $list('?per_page=101')->assertUnprocessable()->assertJsonValidationErrors(['per_page']);
    });

    it('marks held and late reservations', function () {
        $r = booked($this->carla, $this->t5, ['reserved_for' => '2026-10-26T04:30:00Z']);

        $list = fn () => $this->withToken(tokenFor($this->carla))->getJson('/api/v1/reservations')->json('data.0');

        expect($list())->toMatchArray(['ulid' => $r['ulid'], 'is_held' => true, 'is_late' => false]);

        Carbon::setTestNow('2026-10-26 04:45:01');
        expect($list())->toMatchArray(['is_held' => true, 'is_late' => true]);

        Carbon::setTestNow('2026-10-26 06:30:00');
        expect($list())->toMatchArray(['is_held' => false, 'is_late' => true]);
    });
});

describe('PATCH /reservations/{ulid}', function () {
    it('updates the fields sent and audits the change', function () {
        $r = booked($this->carla, $this->t5);
        Carbon::setTestNow('2026-10-26 04:05:00');

        $response = tabRequest($this->carla, 'PATCH', "/api/v1/reservations/{$r['ulid']}", [
            'table_id' => $this->t7->id,
            'reserved_for' => '2026-10-27T20:30:00Z',
            'notes' => 'Window seat',
        ])->assertOk();

        expect($response->json('data'))->toMatchArray([
            'table' => ['id' => $this->t7->id, 'name' => '7', 'area' => 'Patio'],
            'guest_name' => 'Santos',
            'reserved_for' => '2026-10-27T20:30:00Z',
            'business_date' => '2026-10-28',
            'notes' => 'Window seat',
            'updated_at' => '2026-10-26T04:05:00Z',
        ]);

        $audit = lastAudit('reservation.updated');
        expect($audit->changes['reserved_for'])->toEqual(['from' => '2026-10-26T11:00:00Z', 'to' => '2026-10-27T20:30:00Z'])
            ->and($audit->changes['table_id'])->toEqual(['from' => $this->t5->id, 'to' => $this->t7->id]);
    });

    it('runs the same rules and the clash check, excluding itself', function () {
        $r = booked($this->carla, $this->t5);
        booked($this->carla, $this->t5, ['reserved_for' => '2026-10-26T14:00:00Z']);
        $uri = "/api/v1/reservations/{$r['ulid']}";

        // Moving within its own slot doesn't clash with itself.
        tabRequest($this->carla, 'PATCH', $uri, ['reserved_for' => '2026-10-26T11:30:00Z'])->assertOk();

        tabRequest($this->carla, 'PATCH', $uri, ['reserved_for' => '2026-10-26T12:30:00Z'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reserved_for' => 'Table 5 is already reserved at 10:00 PM.']);

        tabRequest($this->carla, 'PATCH', $uri, ['reserved_for' => '2026-10-26T03:00:00Z'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reserved_for' => 'Pick a time from now up to 90 days ahead.']);

        tabRequest($this->carla, 'PATCH', $uri, ['guest_name' => null, 'party_size' => 0])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['guest_name', 'party_size']);

        expect(TableReservation::query()->where('ulid', $r['ulid'])->sole()->reserved_for->toIso8601ZuluString())->toBe('2026-10-26T11:30:00Z');
    });

    it('only works while booked', function () {
        $r = booked($this->carla, $this->t5);
        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel")->assertOk();

        tabRequest($this->carla, 'PATCH', "/api/v1/reservations/{$r['ulid']}", ['party_size' => 2])
            ->assertConflict()
            ->assertExactJson(['message' => 'This reservation is no longer booked.']);
    });
});

describe('cancel and no-show', function () {
    it('cancels a booked reservation once', function () {
        $r = booked($this->carla, $this->t5);

        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel", ['reason' => 'Called to cancel'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.is_held', false);

        $row = TableReservation::query()->sole();
        expect($row->cancel_reason)->toBe('Called to cancel')
            ->and($row->status_changed_by)->toBe($this->carla->id)
            ->and(lastAudit('reservation.cancelled'))->not->toBeNull();

        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel")
            ->assertConflict()
            ->assertExactJson(['message' => 'This reservation is no longer booked.']);

        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/no-show")->assertConflict();
    });

    it('validates the cancel reason', function () {
        $r = booked($this->carla, $this->t5);

        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel", ['reason' => str_repeat('a', 256)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reason']);
    });

    it('marks a no-show only from the reservation time', function () {
        $r = booked($this->carla, $this->t5);
        $uri = "/api/v1/reservations/{$r['ulid']}/no-show";

        Carbon::setTestNow('2026-10-26 10:59:59');
        tabRequest($this->carla, 'POST', $uri)->assertConflict()->assertExactJson(['message' => "It isn't 7:00 PM yet."]);

        Carbon::setTestNow('2026-10-26 11:00:00');
        tabRequest($this->carla, 'POST', $uri)->assertOk()->assertJsonPath('data.status', 'no_show');

        expect(lastAudit('reservation.no_show'))->not->toBeNull();

        tabRequest($this->carla, 'POST', $uri)->assertConflict()->assertExactJson(['message' => 'This reservation is no longer booked.']);
    });
});

describe('seating through POST /tabs', function () {
    it('seats a booked reservation with its party size as the guests', function () {
        $r = booked($this->carla, $this->t5, ['party_size' => 6, 'reserved_for' => '2026-10-26T04:30:00Z']);

        $tab = openTabAt($this->carla, $this->t5->id, ['reservation_ulid' => $r['ulid']]);

        expect($tab['guests'])->toBe(6);

        $row = TableReservation::query()->sole();
        expect($row->status)->toBe('seated')
            ->and($row->tab_id)->toBe(Tab::query()->sole()->id)
            ->and(lastAudit('reservation.seated'))->not->toBeNull();

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/reservations')
            ->assertJsonPath('data.0.status', 'seated')
            ->assertJsonPath('data.0.tab_ulid', $tab['ulid'])
            ->assertJsonPath('data.0.is_held', false);
    });

    it('takes the guests sent over the party size', function () {
        $r = booked($this->carla, $this->t5, ['party_size' => 6]);

        expect(openTabAt($this->carla, $this->t5->id, ['reservation_ulid' => $r['ulid'], 'guests' => 3])['guests'])->toBe(3);
    });

    it('needs the reservation table and a booked reservation', function () {
        $r = booked($this->carla, $this->t5);

        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->t7->id, 'reservation_ulid' => $r['ulid']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['table_id' => 'This reservation is for Table 5.']);

        tabRequest($this->carla, 'POST', "/api/v1/reservations/{$r['ulid']}/cancel")->assertOk();

        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->t5->id, 'reservation_ulid' => $r['ulid']])
            ->assertConflict()
            ->assertExactJson(['message' => 'This reservation is no longer booked.']);

        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->t5->id, 'reservation_ulid' => newUlid()])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reservation_ulid']);

        expect(Tab::query()->count())->toBe(0);
    });
});

describe('the hold', function () {
    it('blocks opening a bill on a held table from the hold start until the slot ends', function () {
        booked($this->carla, $this->t5);
        $held = ['message' => 'Table 5 is reserved for Santos at 7:00 PM.'];
        $open = fn () => tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->t5->id]);

        Carbon::setTestNow('2026-10-26 10:00:00');
        $open()->assertConflict()->assertExactJson($held);

        Carbon::setTestNow('2026-10-26 12:59:59');
        $open()->assertConflict()->assertExactJson($held);

        Carbon::setTestNow('2026-10-26 13:00:00');
        $open()->assertCreated();
    });

    it('lets a bill open before the hold starts', function () {
        booked($this->carla, $this->t5);

        Carbon::setTestNow('2026-10-26 09:59:59');
        openTabAt($this->carla, $this->t5->id);

        expect(Tab::query()->count())->toBe(1);
    });

    it('follows the reservation_hold_minutes setting', function () {
        booked($this->carla, $this->t5);
        setHoldMinutes($this->branch, 0);

        Carbon::setTestNow('2026-10-26 10:59:59');
        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->t5->id])->assertCreated();
    });

    it('blocks a transfer onto a held table', function () {
        booked($this->carla, $this->t7);
        Carbon::setTestNow('2026-10-26 10:30:00');
        $tab = openTabAt($this->carla, $this->t5->id);

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", ['table_id' => $this->t7->id])
            ->assertConflict()
            ->assertExactJson(['message' => 'Table 7 is reserved for Santos at 7:00 PM.']);
    });

    it('shows the next reservation on GET /tables', function () {
        $r = booked($this->carla, $this->t5, ['reserved_for' => '2026-10-26T04:30:00Z', 'party_size' => 3]);
        booked($this->carla, $this->t5, ['reserved_for' => '2026-10-26T11:00:00Z']);
        booked($this->carla, $this->t7, ['reserved_for' => '2026-10-27T04:00:01Z']);

        $response = $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tables')->assertOk();

        expect($response->json('data.0.reservation'))->toBe([
            'ulid' => $r['ulid'],
            'guest_name' => 'Santos',
            'party_size' => 3,
            'reserved_for' => '2026-10-26T04:30:00Z',
            'is_held' => true,
            'is_late' => false,
        ])
            // More than 24 hours ahead.
            ->and($response->json('data.1.reservation'))->toBeNull();
    });
});

describe('the table guards and settings', function () {
    it('refuses to delete or deactivate a table with upcoming reservations', function () {
        booked($this->carla, $this->t5);
        booked($this->carla, $this->t5, ['reserved_for' => '2026-10-27T11:00:00Z']);
        booked($this->carla, $this->t7);
        $admin = fn (string $method, DiningTable $table, array $body = []) => $this->withToken(tokenFor($this->owner))
            ->json($method, "/api/v1/admin/tables/{$table->id}", $body);

        $admin('DELETE', $this->t5)->assertConflict()
            ->assertExactJson(['message' => 'Table 5 has 2 upcoming reservations. Move or cancel them first.']);
        $admin('PATCH', $this->t5, ['is_active' => false])->assertConflict()
            ->assertExactJson(['message' => 'Table 5 has 2 upcoming reservations. Move or cancel them first.']);
        $admin('DELETE', $this->t7)->assertConflict()
            ->assertExactJson(['message' => 'Table 7 has 1 upcoming reservation. Move or cancel it first.']);

        // Renaming is still allowed; once the slot has ended the table can go.
        $admin('PATCH', $this->t7, ['name' => '7A'])->assertOk();
        Carbon::setTestNow('2026-10-26 13:00:00');
        $admin('DELETE', $this->t7)->assertNoContent();
    });

    it('saves reservation_hold_minutes', function () {
        $patch = fn (array $body) => $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', $body);

        $patch(['reservation_hold_minutes' => 240])->assertOk()->assertJsonPath('data.reservation_hold_minutes', 240);
        $patch(['reservation_hold_minutes' => 0])->assertOk()->assertJsonPath('data.reservation_hold_minutes', 0);
        $patch(['reservation_hold_minutes' => 241])->assertUnprocessable()->assertJsonValidationErrors(['reservation_hold_minutes']);
        $patch(['reservation_hold_minutes' => -1])->assertUnprocessable()->assertJsonValidationErrors(['reservation_hold_minutes']);

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/print-config')
            ->assertOk()
            ->assertJsonPath('data.settings.reservation_hold_minutes', 0);
    });

    it('lets dine-in be turned off while reservations are booked', function () {
        booked($this->carla, $this->t5);

        $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', ['dine_in_enabled' => false])
            ->assertOk()
            ->assertJsonPath('data.dine_in_enabled', false);

        expect(TableReservation::query()->sole()->status)->toBe('booked');
    });
});
