<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-26.
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = userWithRole('manager', ['name' => 'Marco Manager']);

    $this->menu = Category::factory()->create(['name' => 'Menu']);
    $this->snacks = Category::factory()->create(['name' => 'Snacks']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);

    $this->meal = Product::factory()->forCategory($this->menu)->create(['name' => 'Fried Chicken', 'price_cents' => 10000]);
    $this->cake = Product::factory()->forCategory($this->snacks)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'is_vatable' => false]);
    $this->tea = Product::factory()->forCategory($this->drinks)->create(['name' => 'Iced Tea', 'price_cents' => 3500]);
});

afterEach(function () {
    Carbon::setTestNow();
});

function salesReport(User $user, string $query): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/reports/sales?'.$query);
}

function salesExport(User $user, string $query): TestResponse
{
    return test()->withToken(tokenFor($user))->get('/api/v1/reports/sales/export?'.$query);
}

/**
 * A sale at a given UTC time (the business date follows from it).
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @return array<string, mixed>
 */
function soldOn(string $at, User $user, array $lines, array $overrides = []): array
{
    Carbon::setTestNow($at);
    $order = sell($user, $lines, $overrides);
    Carbon::setTestNow('2026-09-26 04:00:00');

    return $order;
}

/**
 * Four sales over business days 2026-09-24..26:
 * 1. 09-24, Carla: meal + 2 tea = 17000 (VAT 1821), cash 20000 (change 3000).
 * 2. 09-25, Marco: 2 cake = 9000 − 10% order discount = 8100, GCash.
 * 3. 09-25 (03:59 Manila on the 26th), Carla: 3 tea, renamed "Iced Tea (L)" = 10500 (VAT 1125),
 *    GCash 5000 + cash 6000 (change 500).
 * 4. 09-26, Carla: meal − 10% line discount + cake = 13500 (VAT 964), cash; "Menu" renamed "Mains".
 */
function fourSales(): void
{
    $t = test();

    soldOn('2026-09-24 01:00:00', $t->carla, [[$t->meal, 1], [$t->tea, 2]], [
        'payments' => [['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null]],
    ]);
    soldOn('2026-09-25 01:30:00', $t->marco, [[$t->cake, 2]], [
        'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000],
        'client_total_cents' => 8100,
        'payments' => [['method' => 'gcash', 'amount_cents' => 8100, 'reference_no' => 'G-1']],
    ]);
    $t->tea->update(['name' => 'Iced Tea (L)']);
    soldOn('2026-09-25 19:59:00', $t->carla, [[$t->tea, 3]], [
        'payments' => [
            ['method' => 'gcash', 'amount_cents' => 5000, 'reference_no' => 'G-2'],
            ['method' => 'cash', 'amount_cents' => 6000, 'reference_no' => null],
        ],
    ]);
    $t->menu->update(['name' => 'Mains']);
    soldOn('2026-09-26 02:00:00', $t->carla, [[$t->meal, 1], [$t->cake, 1]], [
        'items' => [
            ['product_id' => $t->meal->id, 'qty' => 1, 'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000], 'notes' => null],
            ['product_id' => $t->cake->id, 'qty' => 1, 'discount' => null, 'notes' => null],
        ],
        'client_total_cents' => 13500,
        'payments' => [['method' => 'cash', 'amount_cents' => 13500, 'reference_no' => null]],
    ]);
}

/**
 * @return array<string, int>
 */
function fourSalesTotals(): array
{
    return [
        'orders_count' => 4,
        'items_sold' => 10,
        'gross_sales_cents' => 51000,
        'discounts_cents' => 1900,
        'net_sales_cents' => 49100,
        'vat_amount_cents' => 3910,
        ...noScPwdFigures(),
        ...reportReversals(49100),
    ];
}

describe('GET /reports/sales', function () {
    it('groups by day over the range, 0-filled, oldest first', function () {
        fourSales();

        salesReport($this->owner, 'from=2026-09-23&to=2026-09-27&group_by=day')->assertOk()->assertExactJson([
            'data' => [
                'from' => '2026-09-23',
                'to' => '2026-09-27',
                'group_by' => 'day',
                'totals' => fourSalesTotals(),
                'rows' => [
                    reportRow('2026-09-23', '2026-09-23', 0, 0, 0, 0, 0),
                    reportRow('2026-09-24', '2026-09-24', 1, 3, 17000, 0, 17000),
                    reportRow('2026-09-25', '2026-09-25', 2, 5, 19500, 900, 18600),
                    reportRow('2026-09-26', '2026-09-26', 1, 2, 14500, 1000, 13500),
                    reportRow('2026-09-27', '2026-09-27', 0, 0, 0, 0, 0),
                ],
            ],
            'meta' => ['truncated' => false],
        ]);
    });

    it('groups by product with line totals as net and the latest name snapshot', function () {
        fourSales();

        salesReport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=product')->assertOk()
            ->assertJsonPath('data.totals', fourSalesTotals())
            ->assertJsonPath('data.rows', [
                reportRow((string) $this->meal->id, 'Fried Chicken', 2, 2, 20000, 1000, 19000, 0),
                reportRow((string) $this->tea->id, 'Iced Tea (L)', 2, 5, 17500, 0, 17500, 0),
                reportRow((string) $this->cake->id, 'Rice Cake', 2, 3, 13500, 900, 12600, 0),
            ])
            ->assertJsonPath('meta.truncated', false);
    });

    it('groups by category snapshot with the latest category name', function () {
        fourSales();

        salesReport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=category')->assertOk()
            ->assertJsonPath('data.rows', [
                reportRow((string) $this->menu->id, 'Mains', 2, 2, 20000, 1000, 19000, 0),
                reportRow((string) $this->drinks->id, 'Drinks', 2, 5, 17500, 0, 17500, 0),
                reportRow((string) $this->snacks->id, 'Snacks', 2, 3, 13500, 900, 12600, 0),
            ]);
    });

    it('groups by payment method, cash first, net of change, without qty, gross or discounts', function () {
        fourSales();

        salesReport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=payment')->assertOk()
            ->assertJsonPath('data.totals', fourSalesTotals())
            ->assertJsonPath('data.rows', [
                reportRow('cash', 'cash', 3, null, null, null, 36000),
                reportRow('gcash', 'gcash', 2, null, null, null, 13100),
            ]);
    });

    it('keeps both payment rows when there are no sales', function () {
        salesReport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=payment')->assertOk()
            ->assertJsonPath('data.rows', [
                reportRow('cash', 'cash', 0, null, null, null, 0),
                reportRow('gcash', 'gcash', 0, null, null, null, 0),
            ])
            ->assertJsonPath('data.totals', [
                'orders_count' => 0, 'items_sold' => 0, 'gross_sales_cents' => 0,
                'discounts_cents' => 0, 'net_sales_cents' => 0, 'vat_amount_cents' => 0,
                ...noScPwdFigures(),
                ...reportReversals(0),
            ]);
    });

    it('groups by cashier with the user\'s name', function () {
        fourSales();

        salesReport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=cashier')->assertOk()
            ->assertJsonPath('data.rows', [
                reportRow((string) $this->carla->id, 'Carla Cashier', 3, 8, 42000, 1000, 41000),
                reportRow((string) $this->marco->id, 'Marco Manager', 1, 2, 9000, 900, 8100),
            ]);
    });

    it('orders ties on net sales by label, then key', function () {
        $alma = userWithRole('cashier', ['name' => 'Alma Cashier']);
        sell($this->carla, [[$this->tea, 1]]);
        sell($alma, [[$this->tea, 1]]);

        expect(array_column(salesReport($this->owner, 'from=2026-09-26&to=2026-09-26&group_by=cashier')->json('data.rows'), 'label'))
            ->toBe(['Alma Cashier', 'Carla Cashier']);
    });

    it('covers only the business dates in the range', function () {
        fourSales();

        salesReport($this->owner, 'from=2026-09-25&to=2026-09-25&group_by=day')->assertOk()
            ->assertJsonPath('data.totals.orders_count', 2)
            ->assertJsonPath('data.rows', [reportRow('2026-09-25', '2026-09-25', 2, 5, 19500, 900, 18600)]);
    });

    it('covers only the sales of the caller\'s branch, counting a voided order as a void', function () {
        fourSales();

        $nick = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('cashier')->create();
        sell($nick, [[$this->meal, 9]]);

        $voided = sell($this->carla, [[$this->meal, 4]]);
        DB::table('orders')->where('ulid', $voided['ulid'])->update(['status' => 'voided']);

        foreach (['day', 'product', 'category', 'payment', 'cashier'] as $group) {
            $data = salesReport($this->owner, "from=2026-09-24&to=2026-09-26&group_by={$group}")->assertOk()->json('data');

            expect($data['totals'])->toBe([...fourSalesTotals(), ...reportReversals(49100, voids: 1, voidsCents: 40000)])
                ->and(array_sum(array_column($data['rows'], 'net_sales_cents')))->toBe(49100);
        }
    });

    it('caps the rows at 500 and says so in meta.truncated', function () {
        $products = Product::factory()->count(501)->forCategory($this->menu)->create(['price_cents' => 100]);

        foreach ($products->chunk(100) as $chunk) {
            sell($this->carla, $chunk->map(fn (Product $product) => [$product, 1])->values()->all());
        }

        $response = salesReport($this->owner, 'from=2026-09-26&to=2026-09-26&group_by=product')->assertOk();

        expect($response->json('data.rows'))->toHaveCount(500)
            ->and($response->json('meta.truncated'))->toBeTrue()
            ->and($response->json('data.totals.items_sold'))->toBe(501);

        salesReport($this->owner, 'from=2026-09-26&to=2026-09-26&group_by=category')->assertOk()
            ->assertJsonPath('meta.truncated', false);
    });

    it('runs two set-based report queries (totals, rows), whatever the data size', function () {
        $count = function (string $group): array {
            $token = tokenFor($this->owner);
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken($token)->getJson("/api/v1/reports/sales?from=2025-09-27&to=2026-09-26&group_by={$group}")->assertOk();
            $queries = array_column(DB::getQueryLog(), 'query');
            DB::disableQueryLog();

            return [count($queries), count(array_filter($queries, fn (string $q) => str_contains($q, '`orders`')))];
        };

        foreach (['day', 'product', 'category', 'payment', 'cashier'] as $group) {
            $small = $count($group);
            fourSales();
            $large = $count($group);

            expect($small[1])->toBe(2, "{$group}: the totals and the rows")
                ->and($large)->toBe($small, "{$group}: no per-row queries");
        }
    });

    it('accepts a range of exactly 366 days', function () {
        salesReport($this->owner, 'from=2025-09-26&to=2026-09-26&group_by=day')->assertOk()
            ->assertJsonCount(366, 'data.rows');
    });

    it('validates the query', function (string $query, string $field, string $message) {
        salesReport($this->owner, $query)->assertUnprocessable()->assertJsonValidationErrors([$field => $message]);
    })->with([
        'from missing' => ['to=2026-09-26&group_by=day', 'from', 'The from field is required.'],
        'to missing' => ['from=2026-09-26&group_by=day', 'to', 'The to field is required.'],
        'group_by missing' => ['from=2026-09-26&to=2026-09-26', 'group_by', 'The group by field is required.'],
        'from format' => ['from=26/09/2026&to=2026-09-26&group_by=day', 'from', 'The from field must match the format Y-m-d.'],
        'to format' => ['from=2026-09-26&to=2026-9-26&group_by=day', 'to', 'The to field must match the format Y-m-d.'],
        'to before from' => ['from=2026-09-26&to=2026-09-25&group_by=day', 'to', 'The to field must be a date after or equal to from.'],
        '367 days' => ['from=2025-09-25&to=2026-09-26&group_by=day', 'to', "The range can't be longer than 366 days."],
        'group_by' => ['from=2026-09-26&to=2026-09-26&group_by=week', 'group_by', 'The selected group by is invalid.'],
        // A malformed `from` with a valid `to` once threw inside the range rule (500).
        'from malformed, to valid' => ['from=26-09-2026&to=2026-09-26&group_by=day', 'from', 'The from field must match the format Y-m-d.'],
    ]);

    it('returns 403 without report.view', function () {
        salesReport($this->carla, 'from=2026-09-26&to=2026-09-26&group_by=day')
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/reports/sales?from=2026-09-26&to=2026-09-26&group_by=day')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

describe('GET /reports/sales/export', function () {
    it('returns the report as a UTF-8 CSV with a BOM, pesos with 2 decimals and a TOTAL line', function () {
        fourSales();

        $response = salesExport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=product')->assertOk();

        expect($response->headers->get('Content-Type'))->toBe('text/csv; charset=UTF-8')
            ->and($response->headers->get('Content-Disposition'))->toBe('attachment; filename="sales-product-2026-09-24-2026-09-26.csv"')
            ->and($response->getContent())->toBe(
                "\u{FEFF}"
                ."key,label,orders_count,qty,gross_sales,discounts,net_sales,refunded_qty,refunds,net_after_refunds\r\n"
                ."{$this->meal->id},\"Fried Chicken\",2,2,200.00,10.00,190.00,0,0.00,190.00\r\n"
                ."{$this->tea->id},\"Iced Tea (L)\",2,5,175.00,0.00,175.00,0,0.00,175.00\r\n"
                ."{$this->cake->id},\"Rice Cake\",2,3,135.00,9.00,126.00,0,0.00,126.00\r\n"
                ."TOTAL,,4,10,510.00,19.00,491.00,0,0.00,491.00\r\n"
            );
    });

    it('writes nulls as empty cells and quotes labels that need it', function () {
        fourSales();
        $this->carla->forceFill(['name' => 'Cruz, "Carla"'])->save();

        expect(salesExport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=payment')->assertOk()->getContent())->toBe(
            "\u{FEFF}"
            ."key,label,orders_count,qty,gross_sales,discounts,net_sales,refunded_qty,refunds,net_after_refunds\r\n"
            ."cash,cash,3,,,,360.00,,0.00,360.00\r\n"
            ."gcash,gcash,2,,,,131.00,,0.00,131.00\r\n"
            ."TOTAL,,4,10,510.00,19.00,491.00,0,0.00,491.00\r\n"
        );

        expect(salesExport($this->owner, 'from=2026-09-24&to=2026-09-26&group_by=cashier')->assertOk()->getContent())
            ->toContain("{$this->carla->id},\"Cruz, \"\"Carla\"\"\",3,8,420.00,10.00,410.00,,0.00,410.00\r\n");
    });

    it('keeps its errors in JSON', function () {
        $this->withToken(tokenFor($this->owner))
            ->get('/api/v1/reports/sales/export?from=2026-09-26&group_by=day', ['Accept' => 'text/csv'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['to' => 'The to field is required.']);

        $this->withToken(tokenFor($this->carla))
            ->get('/api/v1/reports/sales/export?from=2026-09-26&to=2026-09-26&group_by=day', ['Accept' => 'text/csv'])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        $this->flushHeaders()->get('/api/v1/reports/sales/export?from=2026-09-26&to=2026-09-26&group_by=day')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});
