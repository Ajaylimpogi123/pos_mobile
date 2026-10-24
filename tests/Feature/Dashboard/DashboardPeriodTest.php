<?php

/*
|--------------------------------------------------------------------------
| Dashboard Period Filter (v1.28): GET /api/v1/dashboard?period=…&date=…
|--------------------------------------------------------------------------
| The `sales` section over a day, a month or a year of business dates, with its `trend`;
| `business_date` and `last_7_days` stay anchored on the current business date.
*/

use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-10-14 04:00:00'); // 12:00 in Manila: business day 2026-10-14

    $this->owner = userWithRole('owner');
    $this->cashier = userWithRole('cashier');

    $menu = Category::factory()->create(['name' => 'Menu']);
    $this->chicken = Product::factory()->forCategory($menu)->create(['name' => 'Fried Chicken', 'price_cents' => 10000]);
    $this->riceCake = Product::factory()->forCategory($menu)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'is_vatable' => false]);
    $this->icedTea = Product::factory()->forCategory($menu)->create(['name' => 'Iced Tea', 'price_cents' => 3500]);
    $this->water = Product::factory()->forCategory($menu)->create(['name' => 'Bottled Water', 'price_cents' => 2000]);
});

afterEach(function () {
    Carbon::setTestNow();
});

function periodDashboard(User $user, array $query = []): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/dashboard'.($query === [] ? '' : '?'.http_build_query($query)));
}

/**
 * A sale at noon (Manila) of the given business date.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 */
function periodSoldOn(string $businessDate, User $user, array $lines): void
{
    Carbon::setTestNow("{$businessDate} 04:00:00");
    sell($user, $lines);
    Carbon::setTestNow('2026-10-14 04:00:00');
}

/**
 * Consecutive day buckets from `from` to `to`, 0-filled except the given ones.
 *
 * @param  array<string, array{0: int, 1: int}>  $values  start => [orders_count, net_sales_cents]
 * @return list<array{start: string, orders_count: int, net_sales_cents: int}>
 */
function periodDayBuckets(string $from, string $to, array $values = []): array
{
    $buckets = [];
    for ($day = Carbon::parse($from); $day->toDateString() <= $to; $day->addDay()) {
        $date = $day->toDateString();
        $buckets[] = ['start' => $date, 'orders_count' => $values[$date][0] ?? 0, 'net_sales_cents' => $values[$date][1] ?? 0];
    }

    return $buckets;
}

/**
 * Month buckets from January to the given month of a year, 0-filled except the given ones.
 *
 * @param  array<string, array{0: int, 1: int}>  $values  start => [orders_count, net_sales_cents]
 * @return list<array{start: string, orders_count: int, net_sales_cents: int}>
 */
function periodMonthBuckets(int $year, int $lastMonth, array $values = []): array
{
    return array_map(function (int $month) use ($year, $values) {
        $start = sprintf('%04d-%02d-01', $year, $month);

        return ['start' => $start, 'orders_count' => $values[$start][0] ?? 0, 'net_sales_cents' => $values[$start][1] ?? 0];
    }, range(1, $lastMonth));
}

/**
 * Sales on 2025-12-31, 2026-01-10, 2026-09-25, 2026-10-05 and today (2026-10-14).
 */
function periodFixtureSales(): void
{
    $t = test();
    periodSoldOn('2025-12-31', $t->cashier, [[$t->water, 1]]);      // 2000
    periodSoldOn('2026-01-10', $t->cashier, [[$t->icedTea, 1]]);    // 3500
    periodSoldOn('2026-09-25', $t->cashier, [[$t->chicken, 1]]);    // 10000
    periodSoldOn('2026-10-05', $t->cashier, [[$t->riceCake, 2]]);   // 9000
    periodSoldOn('2026-10-14', $t->cashier, [[$t->chicken, 1]]);    // 10000
}

it('keeps the default request on Day / today', function () {
    periodFixtureSales();

    $sales = periodDashboard($this->owner)->assertOk()->json('data.sales');

    expect($sales['period'])->toBe('day')
        ->and($sales['date_from'])->toBe('2026-10-14')
        ->and($sales['date_to'])->toBe('2026-10-14')
        ->and($sales['business_date'])->toBe('2026-10-14')
        ->and($sales['orders_count'])->toBe(1)
        ->and($sales['net_sales_cents'])->toBe(10000)
        ->and($sales['trend'])->toBe(['unit' => 'day', 'buckets' => periodDayBuckets('2026-10-08', '2026-10-14', ['2026-10-14' => [1, 10000]])])
        ->and($sales['last_7_days'])->toBe(array_map(
            fn (array $b) => ['date' => $b['start'], 'orders_count' => $b['orders_count'], 'net_sales_cents' => $b['net_sales_cents']],
            $sales['trend']['buckets'],
        ));

    // An explicit Day / today is the same section.
    expect(periodDashboard($this->owner, ['period' => 'day', 'date' => '2026-10-14'])->json('data.sales'))->toBe($sales);
});

it('computes a past day, with its 7-day trend, while last_7_days stays on today', function () {
    periodFixtureSales();

    $sales = periodDashboard($this->owner, ['period' => 'day', 'date' => '2026-10-05'])->assertOk()->json('data.sales');

    expect($sales)->toMatchArray([
        'period' => 'day',
        'date_from' => '2026-10-05',
        'date_to' => '2026-10-05',
        'business_date' => '2026-10-14',
        'trend' => ['unit' => 'day', 'buckets' => periodDayBuckets('2026-09-29', '2026-10-05', ['2026-10-05' => [1, 9000]])],
        'orders_count' => 1,
        'items_sold' => 2,
        'net_sales_cents' => 9000,
        'average_order_cents' => 9000,
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 1, 'amount_cents' => 9000],
            ['method' => 'gcash', 'orders_count' => 0, 'amount_cents' => 0],
        ],
        'top_products' => [['product_id' => $this->riceCake->id, 'name' => 'Rice Cake', 'qty' => 2, 'net_sales_cents' => 9000]],
    ])->and($sales['last_7_days'])->toBe([
        ['date' => '2026-10-08', 'orders_count' => 0, 'net_sales_cents' => 0],
        ['date' => '2026-10-09', 'orders_count' => 0, 'net_sales_cents' => 0],
        ['date' => '2026-10-10', 'orders_count' => 0, 'net_sales_cents' => 0],
        ['date' => '2026-10-11', 'orders_count' => 0, 'net_sales_cents' => 0],
        ['date' => '2026-10-12', 'orders_count' => 0, 'net_sales_cents' => 0],
        ['date' => '2026-10-13', 'orders_count' => 0, 'net_sales_cents' => 0],
        ['date' => '2026-10-14', 'orders_count' => 1, 'net_sales_cents' => 10000],
    ]);
});

it('clamps the current month to today, with one bucket per day', function () {
    periodFixtureSales();

    $sales = periodDashboard($this->owner, ['period' => 'month', 'date' => '2026-10-05'])->assertOk()->json('data.sales');

    expect($sales)->toMatchArray([
        'period' => 'month',
        'date_from' => '2026-10-01',
        'date_to' => '2026-10-14',
        'business_date' => '2026-10-14',
        'orders_count' => 2,
        'items_sold' => 3,
        'net_sales_cents' => 19000,
        'average_order_cents' => 9500,
        'trend' => ['unit' => 'day', 'buckets' => periodDayBuckets('2026-10-01', '2026-10-14', [
            '2026-10-05' => [1, 9000],
            '2026-10-14' => [1, 10000],
        ])],
    ])->and($sales['trend']['buckets'])->toHaveCount(14)
        ->and(collect($sales['top_products'])->pluck('name')->all())->toBe(['Rice Cake', 'Fried Chicken']);

    // Without a date, the month is the current one.
    expect(periodDashboard($this->owner, ['period' => 'month'])->json('data.sales'))->toBe($sales);
});

it('covers a past month in full, including a leap February', function () {
    periodFixtureSales();

    $september = periodDashboard($this->owner, ['period' => 'month', 'date' => '2026-09-03'])->assertOk()->json('data.sales');

    expect($september)->toMatchArray([
        'date_from' => '2026-09-01',
        'date_to' => '2026-09-30',
        'orders_count' => 1,
        'net_sales_cents' => 10000,
        'trend' => ['unit' => 'day', 'buckets' => periodDayBuckets('2026-09-01', '2026-09-30', ['2026-09-25' => [1, 10000]])],
    ])->and($september['trend']['buckets'])->toHaveCount(30);

    $february = periodDashboard($this->owner, ['period' => 'month', 'date' => '2024-02-10'])->assertOk()->json('data.sales');

    expect($february['date_from'])->toBe('2024-02-01')
        ->and($february['date_to'])->toBe('2024-02-29')
        ->and($february['trend']['buckets'])->toHaveCount(29)
        ->and($february['orders_count'])->toBe(0)
        ->and(collect($february['trend']['buckets'])->sum('orders_count'))->toBe(0)
        ->and($february['top_products'])->toBe([]);
});

it('clamps the current year to today, with one bucket per month', function () {
    periodFixtureSales();

    $sales = periodDashboard($this->owner, ['period' => 'year'])->assertOk()->json('data.sales');

    expect($sales)->toMatchArray([
        'period' => 'year',
        'date_from' => '2026-01-01',
        'date_to' => '2026-10-14',
        'business_date' => '2026-10-14',
        'orders_count' => 4,
        'net_sales_cents' => 32500,
        'trend' => ['unit' => 'month', 'buckets' => periodMonthBuckets(2026, 10, [
            '2026-01-01' => [1, 3500],
            '2026-09-01' => [1, 10000],
            '2026-10-01' => [2, 19000],
        ])],
    ])->and($sales['trend']['buckets'])->toHaveCount(10);
});

it('covers a past year in full', function () {
    periodFixtureSales();

    $sales = periodDashboard($this->owner, ['period' => 'year', 'date' => '2025-06-15'])->assertOk()->json('data.sales');

    expect($sales)->toMatchArray([
        'period' => 'year',
        'date_from' => '2025-01-01',
        'date_to' => '2025-12-31',
        'orders_count' => 1,
        'net_sales_cents' => 2000,
        'trend' => ['unit' => 'month', 'buckets' => periodMonthBuckets(2025, 12, ['2025-12-01' => [1, 2000]])],
    ])->and($sales['trend']['buckets'])->toHaveCount(12);
});

it('groups by business date, so a sale before day_start_time belongs to the previous month', function () {
    // 03:00 on 1 October in Manila: business day 2026-09-30.
    Carbon::setTestNow('2026-09-30 19:00:00');
    sell($this->cashier, [[$this->chicken, 1]]);
    Carbon::setTestNow('2026-10-14 04:00:00');

    expect(periodDashboard($this->owner, ['period' => 'month'])->json('data.sales.orders_count'))->toBe(0)
        ->and(periodDashboard($this->owner, ['period' => 'month', 'date' => '2026-09-30'])->json('data.sales.trend.buckets.29'))
        ->toBe(['start' => '2026-09-30', 'orders_count' => 1, 'net_sales_cents' => 10000])
        ->and(periodDashboard($this->owner, ['period' => 'year'])->json('data.sales.trend.buckets.8'))
        ->toBe(['start' => '2026-09-01', 'orders_count' => 1, 'net_sales_cents' => 10000]);
});

it('rejects a date after the current business date', function () {
    periodDashboard($this->owner, ['date' => '2026-10-15'])
        ->assertUnprocessable()
        ->assertExactJson([
            'message' => "The date can't be in the future.",
            'errors' => ['date' => ["The date can't be in the future."]],
        ]);

    // 03:30 on the 15th in Manila is still business day the 14th.
    Carbon::setTestNow('2026-10-14 19:30:00');
    periodDashboard($this->owner, ['period' => 'month', 'date' => '2026-10-15'])->assertUnprocessable()->assertJsonValidationErrors('date');
    periodDashboard($this->owner, ['period' => 'day', 'date' => '2026-10-14'])->assertOk();

    // The check applies to any caller, even one who can't see `sales`.
    periodDashboard($this->cashier, ['date' => '2026-12-01'])->assertUnprocessable()->assertJsonValidationErrors('date');
});

it('validates period and the date format', function (array $query, string $field) {
    periodDashboard($this->owner, $query)->assertUnprocessable()->assertOnlyJsonValidationErrors($field);
})->with([
    'unknown period' => [['period' => 'week'], 'period'],
    'empty period' => [['period' => ''], 'period'],
    'period as array' => [['period' => ['day']], 'period'],
    'bad date format' => [['date' => '14/10/2026'], 'date'],
    'impossible date' => [['date' => '2026-02-30'], 'date'],
    'empty date' => [['date' => ''], 'date'],
]);

it('requires a token', function () {
    $this->getJson('/api/v1/dashboard?period=month')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
});

it('keeps sales null without report.view, whatever the period', function () {
    periodFixtureSales();

    periodDashboard($this->cashier, ['period' => 'year', 'date' => '2025-03-01'])->assertOk()
        ->assertJsonPath('data.sales', null)
        ->assertJsonPath('data.business_date', '2026-10-14');
});

it('leaves the other sections unchanged', function () {
    periodFixtureSales();

    $default = periodDashboard($this->owner)->assertOk()->json('data');
    $year = periodDashboard($this->owner, ['period' => 'year', 'date' => '2025-03-01'])->assertOk()->json('data');

    foreach (['business_date', 'catalog', 'staff', 'customers', 'activity', 'insights'] as $section) {
        expect($year[$section])->toBe($default[$section]);
    }
});
