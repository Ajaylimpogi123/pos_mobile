<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\TableReservation;
use Carbon\Carbon;
use Carbon\CarbonImmutable;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    setDineIn($this->branch);

    // 12:00 PM in Manila, business day 2026-10-26.
    Carbon::setTestNow('2026-10-26 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = userWithRole('manager', ['name' => 'Marco Manager']);

    $mains = Category::factory()->create(['name' => 'Mains']);
    $this->sisig = Product::factory()->forCategory($mains)->create(['name' => 'Sisig', 'price_cents' => 22500]);

    $this->t5 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'area' => 'Patio']);
    $this->t7 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '7', 'area' => 'Patio', 'sort_order' => 1]);
    $this->t9 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '9', 'area' => 'Patio', 'sort_order' => 2]);
    $this->t10 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '10', 'area' => 'Hall']);
    DiningTable::factory()->forBranch($this->branch)->inactive()->create(['name' => '11']);
});

afterEach(function () {
    Carbon::setTestNow();
});

function tablesSummary($user)
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/tables/summary');
}

it('returns the board figures', function () {
    $first = openTabAt($this->carla, $this->t5->id, ['guests' => 3]);
    sendRound($this->carla, $first['ulid'], [[$this->sisig, 2]]);

    Carbon::setTestNow('2026-10-26 04:30:00');
    openTabAt($this->carla, $this->t7->id, ['guests' => 2]);

    // Held now (7:30 PM booking is not; 12:45 PM is).
    TableReservation::factory()->forTable($this->t9, CarbonImmutable::parse('2026-10-26 04:45:00'))->create(['created_by' => $this->carla->id]);
    TableReservation::factory()->forTable($this->t10, CarbonImmutable::parse('2026-10-26 11:30:00'))->create(['created_by' => $this->carla->id]);
    TableReservation::factory()->forTable($this->t10, CarbonImmutable::parse('2026-10-26 08:00:00'))->create(['created_by' => $this->carla->id, 'status' => 'cancelled']);
    TableReservation::factory()->forTable($this->t10, CarbonImmutable::parse('2026-10-26 01:00:00'))->create(['created_by' => $this->carla->id, 'status' => 'no_show']);
    // Another business day (5:00 AM on the 27th, Manila) and a reservation held on an occupied table.
    TableReservation::factory()->forTable($this->t10, CarbonImmutable::parse('2026-10-26 21:00:00'))->create(['created_by' => $this->carla->id]);
    TableReservation::factory()->forTable($this->t7, CarbonImmutable::parse('2026-10-26 05:00:00'))->create(['created_by' => $this->carla->id]);

    $response = tablesSummary($this->marco)->assertOk();

    expect(array_keys($response->json('data')))->toBe([
        'tables_total', 'tables_occupied', 'tables_reserved', 'tables_free', 'guests_seated',
        'pending_bills', 'pending_cents', 'oldest_open', 'reservations_today', 'generated_at',
    ])
        ->and($response->json('data'))->toBe([
            'tables_total' => 4,
            'tables_occupied' => 2,
            'tables_reserved' => 1,
            'tables_free' => 1,
            'guests_seated' => 5,
            'pending_bills' => 2,
            'pending_cents' => 45000,
            'oldest_open' => ['tab_ulid' => $first['ulid'], 'table_name' => '5', 'opened_at' => '2026-10-26T04:00:00Z'],
            'reservations_today' => ['booked' => 3, 'seated' => 0, 'no_show' => 1, 'cancelled' => 1],
            'generated_at' => '2026-10-26T04:30:00Z',
        ]);
});

it('returns zeros and a null oldest bill when nothing is open', function () {
    tablesSummary($this->marco)->assertOk()->assertExactJson(['data' => [
        'tables_total' => 4,
        'tables_occupied' => 0,
        'tables_reserved' => 0,
        'tables_free' => 4,
        'guests_seated' => 0,
        'pending_bills' => 0,
        'pending_cents' => 0,
        'oldest_open' => null,
        'reservations_today' => ['booked' => 0, 'seated' => 0, 'no_show' => 0, 'cancelled' => 0],
        'generated_at' => '2026-10-26T04:00:00Z',
    ]]);
});

it('keeps each branch separate', function () {
    $other = Branch::factory()->create(['code' => 'OTHER']);
    setDineIn($other);
    $otherTable = DiningTable::factory()->forBranch($other)->create(['name' => '5']);
    TableReservation::factory()->forTable($otherTable, CarbonImmutable::parse('2026-10-26 04:30:00'))->create(['created_by' => $this->carla->id]);

    tablesSummary($this->marco)->assertOk()
        ->assertJsonPath('data.tables_total', 4)
        ->assertJsonPath('data.tables_reserved', 0)
        ->assertJsonPath('data.reservations_today.booked', 0);
});

it('returns 409 while dine-in is off', function () {
    setDineIn($this->branch, false);

    tablesSummary($this->marco)->assertConflict()->assertExactJson(['message' => 'Dine-in tables are turned off in Settings.']);
});

it('needs report.view and a token', function () {
    $this->getJson('/api/v1/tables/summary')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);

    tablesSummary($this->carla)->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);

    // A report.view holder without sale.create reads the board and the tables, but can't open a bill.
    $viewer = userWithRole('cashier');
    $viewer->forceFill(['role_id' => customRole('viewer', ['report.view'])->id])->save();

    tablesSummary($viewer)->assertOk();
    $this->withToken(tokenFor($viewer))->getJson('/api/v1/tables')->assertOk();
    tabRequest($viewer, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->t5->id])->assertForbidden();
});

it('shows last_round_at on GET /tables', function () {
    $tab = openTabAt($this->carla, $this->t5->id);

    $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tables')->assertOk()
        ->assertJsonPath('data.1.tab.last_round_at', null);

    sendRound($this->carla, $tab['ulid'], [[$this->sisig, 1]]);
    Carbon::setTestNow('2026-10-26 04:20:00');
    sendRound($this->carla, $tab['ulid'], [[$this->sisig, 1]]);

    $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tables')->assertOk()
        ->assertJsonPath('data.1.name', '5')
        ->assertJsonPath('data.1.tab.last_round_at', '2026-10-26T04:20:00Z');
});
