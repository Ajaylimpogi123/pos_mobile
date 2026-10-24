<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-25 04:00:00'); // 12:00 in Manila: business day 2026-09-25

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);

    $menu = Category::factory()->create(['name' => 'Menu']);
    $make = fn (string $name, int $price, bool $vatable = true) => Product::factory()->forCategory($menu)
        ->create(['name' => $name, 'price_cents' => $price, 'is_vatable' => $vatable]);

    $this->a = $make('Fried Chicken', 10000);
    $this->b = $make('Rice Cake', 4500, false);
    $this->c = $make('Iced Tea', 3500);
    $this->d = $make('Bottled Water', 2000);
    $this->e = $make('Egg', 1500);
    $this->f = $make('Candy', 999);
});

afterEach(function () {
    Carbon::setTestNow();
});

function salesDashboard(User $user): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/dashboard');
}

/**
 * A sale at a given UTC time.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 */
function soldAt(string $at, User $user, array $lines, array $overrides = []): void
{
    Carbon::setTestNow($at);
    sell($user, $lines, $overrides);
    Carbon::setTestNow('2026-09-25 04:00:00');
}

/**
 * 7 business days ending 2026-09-25, with the given figures.
 *
 * @param  array<string, array{0: int, 1: int}>  $days  date => [orders_count, net_sales_cents]
 * @return list<array{date: string, orders_count: int, net_sales_cents: int}>
 */
function salesWeek(array $days): array
{
    return array_map(fn (string $date) => [
        'date' => $date,
        'orders_count' => $days[$date][0] ?? 0,
        'net_sales_cents' => $days[$date][1] ?? 0,
    ], ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
}

/**
 * v1.28: the default (Day / today) period fields for business day 2026-09-25, with the
 * trend over the same 7 days as `last_7_days`.
 *
 * @param  array<string, array{0: int, 1: int}>  $days  date => [orders_count, net_sales_cents]
 * @return array<string, mixed>
 */
function todayPeriod(array $days): array
{
    return [
        'period' => 'day',
        'date_from' => '2026-09-25',
        'date_to' => '2026-09-25',
        'business_date' => '2026-09-25',
        'trend' => [
            'unit' => 'day',
            'buckets' => array_map(fn (array $day) => [
                'start' => $day['date'],
                'orders_count' => $day['orders_count'],
                'net_sales_cents' => $day['net_sales_cents'],
            ], salesWeek($days)),
        ],
    ];
}

it('computes today\'s figures from real orders of the caller\'s branch', function () {
    // Today (business day 2026-09-25).
    soldAt('2026-09-25 01:00:00', $this->cashier, [[$this->a, 1], [$this->c, 2]], [                   // 17000, VAT 1821
        'payments' => [['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null]],        // change 3000
    ]);
    soldAt('2026-09-25 01:30:00', $this->cashier, [[$this->b, 2]], [                                    // 9000 − 900 = 8100, VAT-exempt
        'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000],
        'client_total_cents' => 8100,
        'payments' => [['method' => 'gcash', 'amount_cents' => 8100, 'reference_no' => 'G-100']],
    ]);
    $this->c->update(['name' => 'Iced Tea (L)']);
    soldAt('2026-09-25 02:00:00', $this->manager, [[$this->c, 3], [$this->d, 1]], [                    // 12500, VAT 1339
        'payments' => [
            ['method' => 'gcash', 'amount_cents' => 5000, 'reference_no' => 'G-101'],
            ['method' => 'cash', 'amount_cents' => 10000, 'reference_no' => null],                     // change 2500
        ],
    ]);
    soldAt('2026-09-25 03:00:00', $this->cashier, [[$this->e, 2], [$this->f, 2]], [                    // 4998, VAT 535
        'payments' => [['method' => 'cash', 'amount_cents' => 5000, 'reference_no' => null]],          // change 2
    ]);

    // Earlier business days: 03:59:59 on the 25th in Manila is still the 24th; the 18th is outside the 7 days.
    soldAt('2026-09-24 19:59:59', $this->cashier, [[$this->a, 1]]);
    soldAt('2026-09-19 05:00:00', $this->cashier, [[$this->a, 1]]);
    soldAt('2026-09-18 05:00:00', $this->cashier, [[$this->a, 1]]);

    // Another branch's sale today: excluded.
    $north = Branch::factory()->create(['code' => 'NORTH']);
    soldAt('2026-09-25 02:30:00', User::factory()->forBranch($north)->withRole('owner')->create(), [[$this->a, 3]]);

    $sales = salesDashboard($this->owner)->assertOk()->json('data.sales');

    expect($sales)->toBe([
        ...todayPeriod([
            '2026-09-19' => [1, 10000],
            '2026-09-24' => [1, 10000],
            '2026-09-25' => [4, 42598],
        ]),
        'orders_count' => 4,
        'items_sold' => 13,
        'gross_sales_cents' => 43498,
        'discounts_cents' => 900,
        'net_sales_cents' => 42598,
        'vat_amount_cents' => 3695,
        ...noScPwdFigures(),
        'average_order_cents' => 10650, // rhu(42598, 4) = 10649.5 → 10650
        'voids_count' => 0,
        'refunds_cents' => 0,
        'net_after_refunds_cents' => 42598,
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 3, 'amount_cents' => 29498],  // 17000 + 7500 + 4998, net of change
            ['method' => 'gcash', 'orders_count' => 2, 'amount_cents' => 13100],
        ],
        'last_7_days' => salesWeek([
            '2026-09-19' => [1, 10000],
            '2026-09-24' => [1, 10000],
            '2026-09-25' => [4, 42598],
        ]),
        'top_products' => [
            ['product_id' => $this->c->id, 'name' => 'Iced Tea (L)', 'qty' => 5, 'net_sales_cents' => 17500],
            ['product_id' => $this->b->id, 'name' => 'Rice Cake', 'qty' => 2, 'net_sales_cents' => 8100],
            ['product_id' => $this->e->id, 'name' => 'Egg', 'qty' => 2, 'net_sales_cents' => 3000],
            ['product_id' => $this->f->id, 'name' => 'Candy', 'qty' => 2, 'net_sales_cents' => 1998],
            ['product_id' => $this->a->id, 'name' => 'Fried Chicken', 'qty' => 1, 'net_sales_cents' => 10000],
        ],
    ]);

    // The other branch sees only its own sale.
    expect(salesDashboard(User::factory()->forBranch($north)->withRole('manager')->create())->json('data.sales.orders_count'))->toBe(1);
});

it('breaks top-product ties by name', function () {
    $zeta = Product::factory()->forCategory($this->a->category)->create(['name' => 'Zeta', 'price_cents' => 1000]);
    $alpha = Product::factory()->forCategory($this->a->category)->create(['name' => 'Alpha', 'price_cents' => 1000]);

    sell($this->cashier, [[$zeta, 2], [$alpha, 2]]);

    expect(collect(salesDashboard($this->owner)->json('data.sales.top_products'))->pluck('name')->all())->toBe(['Alpha', 'Zeta']);
});

it('keeps the fixed shapes, all zero, with no sales today', function () {
    soldAt('2026-09-24 12:00:00', $this->cashier, [[$this->a, 1]]); // yesterday only

    expect(salesDashboard($this->owner)->assertOk()->json('data.sales'))->toBe([
        ...todayPeriod(['2026-09-24' => [1, 10000]]),
        'orders_count' => 0,
        'items_sold' => 0,
        'gross_sales_cents' => 0,
        'discounts_cents' => 0,
        'net_sales_cents' => 0,
        'vat_amount_cents' => 0,
        ...noScPwdFigures(),
        'average_order_cents' => 0,
        'voids_count' => 0,
        'refunds_cents' => 0,
        'net_after_refunds_cents' => 0,
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 0, 'amount_cents' => 0],
            ['method' => 'gcash', 'orders_count' => 0, 'amount_cents' => 0],
        ],
        'last_7_days' => salesWeek(['2026-09-24' => [1, 10000]]),
        'top_products' => [],
    ]);
});

it('is null without report.view', function () {
    sell($this->cashier, [[$this->a, 1]]);

    salesDashboard($this->cashier)->assertOk()->assertJsonPath('data.sales', null);

    $staffAdmin = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('staffer', ['user.manage'])->id]);
    salesDashboard($staffAdmin)->assertOk()->assertJsonPath('data.sales', null);

    $reporter = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('reporter', ['report.view'])->id]);
    salesDashboard($reporter)->assertOk()->assertJsonPath('data.sales.orders_count', 1);
});

it('follows the business day rollover', function () {
    soldAt('2026-09-24 20:00:00', $this->cashier, [[$this->a, 1]]); // 04:00 on the 25th in Manila

    Carbon::setTestNow('2026-09-24 19:59:00'); // 03:59 on the 25th: still business day the 24th
    salesDashboard($this->owner)->assertOk()
        ->assertJsonPath('data.sales.business_date', '2026-09-24')
        ->assertJsonPath('data.sales.orders_count', 0);

    Carbon::setTestNow('2026-09-25 19:00:00');
    salesDashboard($this->owner)->assertOk()
        ->assertJsonPath('data.sales.business_date', '2026-09-25')
        ->assertJsonPath('data.sales.orders_count', 1);
});

describe('activity', function () {
    it('leaves sales out of the activity feed and shows stock adjustments', function () {
        $this->c->update(['track_stock' => true]);
        stockUp($this->c, 10);

        sell($this->cashier, [[$this->a, 1]]);
        sell($this->cashier, [[$this->c, 1]]);

        Carbon::setTestNow('2026-09-25 04:01:00');
        $this->withToken(tokenFor($this->manager))->postJson(
            "/api/v1/admin/products/{$this->c->id}/stock-adjustments",
            $body = ['ulid' => newUlid(), 'qty_delta' => 24, 'reason' => 'Delivery'],
            ['Idempotency-Key' => $body['ulid']],
        )->assertCreated();

        Carbon::setTestNow('2026-09-25 04:02:00');
        $this->withToken(tokenFor($this->manager))->postJson(
            "/api/v1/admin/products/{$this->c->id}/stock-adjustments",
            $body = ['ulid' => newUlid(), 'counted_qty' => 28, 'reason' => 'Count'],
            ['Idempotency-Key' => $body['ulid']],
        )->assertCreated();

        $activity = salesDashboard($this->owner)->assertOk()->json('data.activity');

        expect($activity['changes_by_day'][6])->toBe(['date' => '2026-09-25', 'count' => 2])
            ->and(collect($activity['recent_changes'])->map(fn (array $c) => [$c['action'], $c['summary'], $c['actor_name']])->all())->toBe([
                ['stock.adjusted', 'Adjusted stock of "Iced Tea" (-5)', 'Marco Manager'],
                ['stock.adjusted', 'Adjusted stock of "Iced Tea" (+24)', 'Marco Manager'],
            ]);
    });

    it('does not count PIN switches as changes', function () {
        withPin($this->manager, '2468');

        $this->withToken(tokenFor($this->cashier))->postJson('/api/v1/auth/pin', ['user_id' => $this->manager->id, 'pin' => '2468'])->assertOk();

        $activity = salesDashboard($this->owner)->assertOk()->json('data.activity');

        expect($activity['changes_by_day'][6]['count'])->toBe(0)
            ->and($activity['recent_changes'])->toBe([]);
    });
});
