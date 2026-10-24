<?php

use App\Models\Category;
use App\Models\Product;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/*
| Phase 7: voids and refunds in every sales figure (the shift report, the dashboard `sales`
| section, the sales reports and their CSV), and the exit criterion: after a void and a
| partial refund, stock and money reconcile exactly.
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-27.
    Carbon::setTestNow('2026-09-27 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $this->breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $this->meals = Category::factory()->create(['name' => 'Meals']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);

    $this->hotDog = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Hot Dog', 'price_cents' => 8000, 'cost_cents' => 3600]);
    $this->riceCake = Product::factory()->forCategory($this->meals)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'cost_cents' => 2000, 'is_vatable' => false]);
    $this->icedTea = Product::factory()->forCategory($this->drinks)->create(['name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true]);
    stockUp($this->icedTea, 50);

    $this->installId = newUlid();
    $this->token = deviceToken($this->carla, $this->installId);
    $this->marcoToken = deviceToken($this->marco, $this->installId);
    $this->shift = openShift($this->token, $this->carla, ['opening_float_cents' => 200000]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * In the shift, on 2026-09-27:
 * - A (Carla): worked example B, 25700 (GCash 10000, cash 15700 net of change); partly refunded:
 *   1 Iced Tea (3369, cash) + 1 Rice Cake (4332, GCash) = 7701.
 * - B (Carla): 2 Hot Dogs, 16000 cash; voided.
 * - C (Marco): 1 Iced Tea, 3500 cash.
 */
function voidAndPartialRefund(): void
{
    $t = test();
    $shift = $t->shift['ulid'];

    $t->saleA = postOrder($t->carla, [
        'ulid' => newUlid(),
        'shift_ulid' => $shift,
        'customer_id' => null,
        'notes' => null,
        'items' => [
            ['product_id' => $t->hotDog->id, 'qty' => 1, 'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000], 'notes' => null],
            ['product_id' => $t->riceCake->id, 'qty' => 2, 'discount' => null, 'notes' => null],
            ['product_id' => $t->icedTea->id, 'qty' => 3, 'discount' => null, 'notes' => null],
        ],
        'discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 1000],
        'payments' => [
            ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => '1012345678901'],
            ['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null],
        ],
        'client_total_cents' => 25700,
        'discount_authorization' => null,
    ])->assertCreated()->json('data');

    $t->saleB = sell($t->carla, [[$t->hotDog, 2]], ['shift_ulid' => $shift]);
    $t->saleC = sell($t->marco, [[$t->icedTea, 1]], ['shift_ulid' => $shift]);

    postVoid($t->marcoToken, $t->saleB['ulid'], voidBody())->assertOk();

    [, $riceLine, $teaLine] = array_column($t->saleA['items'], 'id');

    postRefund($t->marcoToken, $t->saleA['ulid'], refundBody($shift, [[$teaLine, 1], [$riceLine, 1]], [
        ['method' => 'cash', 'amount_cents' => 3369],
        ['method' => 'gcash', 'amount_cents' => 4332, 'reference_no' => 'R-1'],
    ]))->assertCreated()->assertJsonPath('data.refunds.0.vatable_sales_cents', 3008);
}

function figuresReport(string $query): array
{
    return test()->withToken(tokenFor(test()->owner))->getJson('/api/v1/reports/sales?'.$query)->assertOk()->json('data');
}

it('reconciles stock and money exactly after a void and a partial refund (the exit criterion)', function () {
    voidAndPartialRefund();

    expectReconciled();

    // Iced Tea: 50 − 3 (A) − 1 (C) + 1 (refund); the voided sale took no tracked stock.
    expect(stockOf($this->icedTea))->toBe(47);

    // Net after refunds = the money kept: payments of the sales (not voided) − money given back.
    $payments = (int) DB::table('payments')->join('orders', 'orders.id', '=', 'payments.order_id')
        ->where('orders.status', '!=', 'voided')->sum('payments.amount_cents');
    $givenBack = (int) DB::table('refund_payments')->sum('amount_cents');

    expect($payments - $givenBack)->toBe(21499)
        ->and(figuresReport('from=2026-09-27&to=2026-09-27&group_by=day')['totals']['net_after_refunds_cents'])->toBe(21499)
        ->and($this->withToken(tokenFor($this->owner))->getJson("/api/v1/shifts/{$this->shift['ulid']}")->json('data.report.net_after_refunds_cents'))->toBe(21499);
});

it('voids a sale with tracked stock back to the exact ledger', function () {
    $sale = sell($this->carla, [[$this->icedTea, 4], [$this->hotDog, 1]], ['shift_ulid' => $this->shift['ulid']]);
    expect(stockOf($this->icedTea))->toBe(46);

    postVoid($this->marcoToken, $sale['ulid'], voidBody())->assertOk();

    expect(stockOf($this->icedTea))->toBe(50);
    expectReconciled();
});

it('computes the shift report with voids, refunds by method and cash refunds out of the drawer', function () {
    voidAndPartialRefund();

    expect($this->withToken(tokenFor($this->owner))->getJson("/api/v1/shifts/{$this->shift['ulid']}")->assertOk()->json('data.report'))->toBe([
        'orders_count' => 2,
        'items_sold' => 7,
        'gross_sales_cents' => 31000,
        'discounts_cents' => 1800,
        'net_sales_cents' => 29200,
        'vatable_sales_cents' => 18337,
        'vat_amount_cents' => 2200,
        'vat_exempt_sales_cents' => 8663,
        ...noScPwdFigures(),
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 2, 'amount_cents' => 19200],
            ['method' => 'gcash', 'orders_count' => 1, 'amount_cents' => 10000],
        ],
        'voids_count' => 1,
        'voids_cents' => 16000,
        'refunds_count' => 1,
        'refunds_cents' => 7701,
        'refunds_by_method' => [
            ['method' => 'cash', 'amount_cents' => 3369],
            ['method' => 'gcash', 'amount_cents' => 4332],
        ],
        'net_after_refunds_cents' => 21499,
        'cash_in_cents' => 0,
        'cash_out_cents' => 0,
        'expected_cash_cents' => 215831, // 200000 + 19200 − 3369
        'variance_cents' => null,
        'by_cashier' => [
            ['user_id' => $this->carla->id, 'name' => 'Carla Cashier', 'orders_count' => 1, 'net_sales_cents' => 25700],
            ['user_id' => $this->marco->id, 'name' => 'Marco Manager', 'orders_count' => 1, 'net_sales_cents' => 3500],
        ],
        'needs_review_count' => 0,
    ]);
});

it('counts a refund in the refunding tablet\'s shift, not the sale\'s', function () {
    voidAndPartialRefund();
    $otherTablet = deviceToken($this->marco);
    $otherShift = openShift($otherTablet, $this->marco, ['opening_float_cents' => 50000]);

    postRefund($otherTablet, $this->saleA['ulid'], refundBody($otherShift['ulid'], [[$this->saleA['items'][0]['id'], 1]], [
        ['method' => 'cash', 'amount_cents' => 6930],
    ]))->assertCreated();

    $report = fn (string $ulid) => $this->withToken(tokenFor($this->owner))->getJson("/api/v1/shifts/{$ulid}")->assertOk()->json('data.report');

    expect($report($otherShift['ulid']))->toMatchArray([
        'orders_count' => 0,
        'refunds_count' => 1,
        'refunds_cents' => 6930,
        'refunds_by_method' => [['method' => 'cash', 'amount_cents' => 6930], ['method' => 'gcash', 'amount_cents' => 0]],
        'net_after_refunds_cents' => -6930,
        'expected_cash_cents' => 43070,
    ])
        ->and($report($this->shift['ulid']))->toMatchArray(['refunds_count' => 1, 'refunds_cents' => 7701, 'expected_cash_cents' => 215831]);
});

it('adds today\'s voids and refunds to the dashboard', function () {
    voidAndPartialRefund();

    expect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/dashboard')->assertOk()->json('data.sales'))->toMatchArray([
        'orders_count' => 2,
        'items_sold' => 7,
        'net_sales_cents' => 29200,
        'average_order_cents' => 14600,
        'voids_count' => 1,
        'refunds_cents' => 7701,
        'net_after_refunds_cents' => 21499,
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 2, 'amount_cents' => 19200],
            ['method' => 'gcash', 'orders_count' => 1, 'amount_cents' => 10000],
        ],
    ]);
});

it('counts voids and refunds on their own business day inside the dashboard period (v1.28)', function () {
    voidAndPartialRefund();

    // The next business day: a second refund of sale A and a void of sale C (both from the 27th).
    Carbon::setTestNow('2026-09-28 04:00:00');
    [, , $teaLine] = array_column($this->saleA['items'], 'id');
    postRefund($this->marcoToken, $this->saleA['ulid'], refundBody($this->shift['ulid'], [[$teaLine, 1]], [
        ['method' => 'cash', 'amount_cents' => 3369],
    ]))->assertCreated();
    postVoid($this->marcoToken, $this->saleC['ulid'], voidBody())->assertOk();

    $sales = fn (array $query) => $this->withToken(tokenFor($this->owner))
        ->getJson('/api/v1/dashboard?'.http_build_query($query))->assertOk()->json('data.sales');

    // The 27th: sales A only now (B and C voided, both on the order's day); the first refund.
    expect($sales(['period' => 'day', 'date' => '2026-09-27']))->toMatchArray([
        'orders_count' => 1,
        'net_sales_cents' => 25700,
        'voids_count' => 2,
        'refunds_cents' => 7701,
        'net_after_refunds_cents' => 25700 - 7701,
    ]);

    // The 28th (today): no sale, no void, the second refund.
    $secondRefund = 3369; // accepted above: client_refund_cents matches the server's amount
    expect($sales(['period' => 'day', 'date' => '2026-09-28']))->toMatchArray([
        'business_date' => '2026-09-28',
        'orders_count' => 0,
        'voids_count' => 0,
        'refunds_cents' => $secondRefund,
        'net_after_refunds_cents' => -$secondRefund,
    ]);

    // The month holds both days.
    expect($sales(['period' => 'month']))->toMatchArray([
        'date_from' => '2026-09-01',
        'date_to' => '2026-09-28',
        'orders_count' => 1,
        'net_sales_cents' => 25700,
        'voids_count' => 2,
        'refunds_cents' => 7701 + $secondRefund,
        'net_after_refunds_cents' => 25700 - 7701 - $secondRefund,
    ]);
});

describe('sales reports', function () {
    beforeEach(function () {
        voidAndPartialRefund();
    });

    it('adds the voids and refunds to the totals and the day rows', function () {
        $data = figuresReport('from=2026-09-26&to=2026-09-27&group_by=day');

        expect($data['totals'])->toBe([
            'orders_count' => 2,
            'items_sold' => 7,
            'gross_sales_cents' => 31000,
            'discounts_cents' => 1800,
            'net_sales_cents' => 29200,
            'vat_amount_cents' => 2200,
            ...noScPwdFigures(),
            'voids_count' => 1,
            'voids_cents' => 16000,
            'refunds_count' => 1,
            'refunds_cents' => 7701,
            'net_after_refunds_cents' => 21499,
        ])
            ->and($data['rows'])->toBe([
                reportRow('2026-09-26', '2026-09-26', 0, 0, 0, 0, 0),
                reportRow('2026-09-27', '2026-09-27', 2, 7, 31000, 1800, 29200, null, 7701),
            ]);
    });

    it('adds the refund lines to the product and category rows, with refunded_qty', function () {
        expect(figuresReport('from=2026-09-27&to=2026-09-27&group_by=product')['rows'])->toBe([
            reportRow((string) $this->icedTea->id, 'Iced Tea', 2, 4, 14000, 393, 13607, 1, 3369),
            reportRow((string) $this->riceCake->id, 'Rice Cake', 1, 2, 9000, 337, 8663, 1, 4332),
            reportRow((string) $this->hotDog->id, 'Hot Dog', 1, 1, 8000, 1070, 6930, 0, 0),
        ])
            ->and(figuresReport('from=2026-09-27&to=2026-09-27&group_by=category')['rows'])->toBe([
                reportRow((string) $this->drinks->id, 'Drinks', 2, 4, 14000, 393, 13607, 1, 3369),
                reportRow((string) $this->meals->id, 'Meals', 1, 2, 9000, 337, 8663, 1, 4332),
                reportRow((string) $this->breakfast->id, 'Breakfast', 1, 1, 8000, 1070, 6930, 0, 0),
            ]);
    });

    it('gives no row to a product or category sold only on voided sales', function () {
        $snacks = Category::factory()->create(['name' => 'Snacks']);
        $candy = Product::factory()->forCategory($snacks)->create(['name' => 'Candy', 'price_cents' => 999]);
        $sale = sell($this->carla, [[$candy, 2]], ['shift_ulid' => $this->shift['ulid']]);
        postVoid($this->marcoToken, $sale['ulid'], voidBody())->assertOk();

        expect(array_column(figuresReport('from=2026-09-27&to=2026-09-27&group_by=product')['rows'], 'label'))->toBe(['Iced Tea', 'Rice Cake', 'Hot Dog'])
            ->and(array_column(figuresReport('from=2026-09-27&to=2026-09-27&group_by=category')['rows'], 'label'))->toBe(['Drinks', 'Meals', 'Breakfast'])
            ->and(figuresReport('from=2026-09-27&to=2026-09-27&group_by=payment')['rows'][0])->toBe(reportRow('cash', 'cash', 2, null, null, null, 19200, null, 3369))
            ->and(figuresReport('from=2026-09-27&to=2026-09-27&group_by=day')['totals'])->toMatchArray(['voids_count' => 2, 'voids_cents' => 17998]);
    });

    it('adds the money given back to the payment rows, and the refunds to the original cashier', function () {
        expect(figuresReport('from=2026-09-27&to=2026-09-27&group_by=payment')['rows'])->toBe([
            reportRow('cash', 'cash', 2, null, null, null, 19200, null, 3369),
            reportRow('gcash', 'gcash', 1, null, null, null, 10000, null, 4332),
        ])
            ->and(figuresReport('from=2026-09-27&to=2026-09-27&group_by=cashier')['rows'])->toBe([
                // Marco made the refund; it counts for Carla, who rang up the sale.
                reportRow((string) $this->carla->id, 'Carla Cashier', 1, 6, 27500, 1800, 25700, null, 7701),
                reportRow((string) $this->marco->id, 'Marco Manager', 1, 1, 3500, 0, 3500),
            ]);
    });

    it('counts a later refund on its own day, with a row for a product refunded but not sold', function () {
        Carbon::setTestNow('2026-09-28 04:00:00');
        $shift = openShift($this->token, $this->carla);
        postRefund($this->marcoToken, $this->saleA['ulid'], refundBody($shift['ulid'], [[$this->saleA['items'][0]['id'], 1]], [
            ['method' => 'cash', 'amount_cents' => 6930],
        ]))->assertCreated();

        $range = 'from=2026-09-28&to=2026-09-28&group_by=';

        expect(figuresReport($range.'day'))->toMatchArray([
            'totals' => [
                'orders_count' => 0, 'items_sold' => 0, 'gross_sales_cents' => 0, 'discounts_cents' => 0,
                'net_sales_cents' => 0, 'vat_amount_cents' => 0,
                ...noScPwdFigures(),
                'voids_count' => 0, 'voids_cents' => 0, 'refunds_count' => 1, 'refunds_cents' => 6930,
                'net_after_refunds_cents' => -6930,
            ],
            'rows' => [reportRow('2026-09-28', '2026-09-28', 0, 0, 0, 0, 0, null, 6930)],
        ])
            ->and(figuresReport($range.'product')['rows'])->toBe([reportRow((string) $this->hotDog->id, 'Hot Dog', 0, 0, 0, 0, 0, 1, 6930)])
            ->and(figuresReport($range.'category')['rows'])->toBe([reportRow((string) $this->breakfast->id, 'Breakfast', 0, 0, 0, 0, 0, 1, 6930)])
            ->and(figuresReport($range.'cashier')['rows'])->toBe([reportRow((string) $this->carla->id, 'Carla Cashier', 0, 0, 0, 0, 0, null, 6930)])
            ->and(figuresReport($range.'payment')['rows'])->toBe([
                reportRow('cash', 'cash', 0, null, null, null, 0, null, 6930),
                reportRow('gcash', 'gcash', 0, null, null, null, 0),
            ]);

        // The sale's day keeps its figures; only its refunds' days change.
        expect(figuresReport('from=2026-09-27&to=2026-09-27&group_by=day')['totals']['refunds_cents'])->toBe(7701);
    });

    it('writes the refund columns and a filled TOTAL line to the CSV', function () {
        $csv = $this->withToken(tokenFor($this->owner))->get('/api/v1/reports/sales/export?from=2026-09-27&to=2026-09-27&group_by=product')
            ->assertOk()
            ->getContent();

        expect($csv)->toBe(
            "\u{FEFF}"
            ."key,label,orders_count,qty,gross_sales,discounts,net_sales,refunded_qty,refunds,net_after_refunds\r\n"
            ."{$this->icedTea->id},\"Iced Tea\",2,4,140.00,3.93,136.07,1,33.69,102.38\r\n"
            ."{$this->riceCake->id},\"Rice Cake\",1,2,90.00,3.37,86.63,1,43.32,43.31\r\n"
            ."{$this->hotDog->id},\"Hot Dog\",1,1,80.00,10.70,69.30,0,0.00,69.30\r\n"
            ."TOTAL,,2,7,310.00,18.00,292.00,2,77.01,214.99\r\n"
        );

        expect($this->withToken(tokenFor($this->owner))->get('/api/v1/reports/sales/export?from=2026-09-27&to=2026-09-27&group_by=payment')->getContent())
            ->toContain("cash,cash,2,,,,192.00,,33.69,158.31\r\n")
            ->toContain("TOTAL,,2,7,310.00,18.00,292.00,2,77.01,214.99\r\n");
    });

    it('still runs two report statements per report with voids and refunds', function () {
        foreach (['day', 'product', 'category', 'payment', 'cashier'] as $group) {
            $token = tokenFor($this->owner);
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->withToken($token)->getJson("/api/v1/reports/sales?from=2026-09-01&to=2026-09-30&group_by={$group}")->assertOk();
            $queries = array_column(DB::getQueryLog(), 'query');
            DB::disableQueryLog();

            expect(count(array_filter($queries, fn (string $q) => str_contains($q, DB::getQueryGrammar()->wrapTable('orders')))))->toBe(2, $group);
        }
    });
});

it('returns exactly the total on a full refund, leaving the sale\'s net after refunds at 0', function () {
    $sale = sell($this->carla, [[$this->icedTea, 3], [$this->riceCake, 1]], [
        'shift_ulid' => $this->shift['ulid'],
        'discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 333],
        'client_total_cents' => 14667,
        'payments' => [['method' => 'cash', 'amount_cents' => 14667, 'reference_no' => null]],
    ]);

    $data = postRefund($this->marcoToken, $sale['ulid'], refundBody($this->shift['ulid'], [[$sale['items'][0]['id'], 3], [$sale['items'][1]['id'], 1]], [
        ['method' => 'cash', 'amount_cents' => 14667],
    ]))->assertCreated()->json('data');

    expect($data['status'])->toBe('refunded')
        ->and($data['refunded_cents'])->toBe($data['total_cents'])
        ->and(figuresReport('from=2026-09-27&to=2026-09-27&group_by=day')['totals'])->toMatchArray([
            'net_sales_cents' => 14667,
            'refunds_cents' => 14667,
            'net_after_refunds_cents' => 0,
        ]);

    expectReconciled();
});
