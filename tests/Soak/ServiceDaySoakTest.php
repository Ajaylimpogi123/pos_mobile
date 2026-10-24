<?php

use App\Models\Category;
use App\Models\Device;
use App\Models\Ingredient;
use App\Models\Order;
use App\Models\Product;
use App\Models\RecipeLine;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Sales\Discount;
use App\Support\Sales\RefundCalculator;
use App\Support\Sales\SaleCalculator;
use App\Support\Sales\SaleLine;
use App\Support\Sales\ScPwd;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
| Hardening & Pilot → G: the backend soak. One service day on a seeded catalogue, on the real
| MySQL (pos_mobile_test: migrated fresh, the data committed, then truncated by DatabaseTruncation):
|
| - 3 tablets, each with its own shift (opened, cash in and out, closed with a count);
| - 600 orders: 70% online, 30% offline in batches of 25 (every batch replayed once, some
|   orders sent both online and offline, and mid-batch retries); recipe and `own` products,
|   discounts, SC/PWD and split payments;
| - 10 voids and 15 full or partial refunds; one PO receipt; one Set cost during service.
|
| Afterwards: no duplicate orders or payments, every ULID accounted for, Σ payments − Σ refund
| payments = the sales report's net, each Z-read equals its orders (and the counted cash its
| expected cash), the stock ledger and the ingredient value invariant hold, and the inventory
| and purchasing reports reconcile. Timing: p95 of POST /orders under 300 ms and a 25-order
| /sync/orders batch under 2 s. Excluded from the default run:
|
|     php artisan test --group=soak
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 10:00 in Manila: business day 2026-10-12.
    Carbon::setTestNow('2026-10-12 02:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Replace a product's recipe directly: `[component, qty, unit, base_qty]` per line.
 *
 * @param  list<array{0: Ingredient|Product, 1: string, 2: string, 3: string}>  $lines
 */
function soakRecipe(Product $product, array $lines): void
{
    foreach ($lines as [$component, $qty, $unit, $base]) {
        (new RecipeLine)->forceFill([
            'product_id' => $product->id,
            'ingredient_id' => $component instanceof Ingredient ? $component->id : null,
            'component_product_id' => $component instanceof Product ? $component->id : null,
            'qty' => $qty,
            'unit' => $unit,
            'base_qty' => $base,
        ])->save();
    }
}

/**
 * A sale body priced with the server's calculator (the app runs the same algorithm), paid
 * exactly: in cash, or split GCash + cash. `$lines` are `[Product, qty]`.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @return array<string, mixed>
 */
function soakSale(array $lines, string $shiftUlid, ?array $discount, bool $scPwd, bool $split): array
{
    $saleLines = [];

    foreach ($lines as $i => [$product, $qty]) {
        $saleLines[] = new SaleLine($product->price_cents, $qty, (bool) $product->is_vatable, null, $scPwd && $i === 0);
    }

    $scPwdBody = $scPwd ? [
        'mode' => 'items',
        'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA-'.random_int(10000, 99999)]],
        'diners' => null,
        'vat_exempt' => true,
    ] : null;

    $total = SaleCalculator::fromConfig()->price($saleLines, Discount::fromArray($discount), ScPwd::fromArray($scPwdBody))->totalCents;

    $payments = $split && $total > 100
        ? [
            ['method' => 'gcash', 'amount_cents' => intdiv($total, 2), 'reference_no' => (string) random_int(1000000000000, 9999999999999)],
            ['method' => 'cash', 'amount_cents' => $total - intdiv($total, 2), 'reference_no' => null],
        ]
        : [['method' => 'cash', 'amount_cents' => $total, 'reference_no' => null]];

    return [
        'ulid' => newUlid(),
        'shift_ulid' => $shiftUlid,
        'customer_id' => null,
        'notes' => null,
        'items' => array_map(fn (array $line, int $i) => [
            'product_id' => $line[0]->id,
            'qty' => $line[1],
            'discount' => null,
            'notes' => null,
            'sc_pwd' => $scPwd && $i === 0,
        ], $lines, array_keys($lines)),
        'discount' => $discount,
        'sc_pwd' => $scPwdBody,
        'payments' => $payments,
        'client_total_cents' => $total,
        'discount_authorization' => null,
    ];
}

/**
 * The same sale as an `OfflineOrder` of the given tablet and cashier.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @param  array<string, mixed>  $sale
 * @return array<string, mixed>
 */
function soakOffline(array $sale, array $lines, Device $device, User $cashier, int $sequence): array
{
    $offline = $sale;
    unset($offline['discount_authorization']);

    foreach ($offline['items'] as $i => $item) {
        $offline['items'][$i]['unit_price_cents'] = $lines[$i][0]->price_cents;
    }

    return [
        ...$offline,
        'order_no' => sprintf('%s-20261012-%04d', $device->code, $sequence),
        'placed_at' => now()->subMinutes(5)->toIso8601ZuluString(),
        'cashier_id' => $cashier->id,
        'table_no' => null,
    ];
}

/**
 * POST /orders with the tablet's token, timed in milliseconds.
 *
 * @param  list<float>  $timings
 */
function soakPostOrder(string $token, array $sale, array &$timings): TestResponse
{
    $start = hrtime(true);
    $response = test()->withToken($token)->postJson('/api/v1/orders', $sale, ['Idempotency-Key' => $sale['ulid']]);
    $timings[] = (hrtime(true) - $start) / 1e6;

    return $response;
}

/**
 * POST /sync/orders, returning each result's status by ulid; timed in milliseconds.
 *
 * @param  list<array<string, mixed>>  $orders
 * @param  list<float>  $timings
 * @return array<string, string>
 */
function soakSync(string $token, array $orders, array &$timings): array
{
    $start = hrtime(true);
    $response = test()->withToken($token)->postJson('/api/v1/sync/orders', ['orders' => $orders])->assertOk();
    $timings[] = (hrtime(true) - $start) / 1e6;

    return array_column($response->json('data'), 'status', 'ulid');
}

function soakPercentile(array $values, float $percentile): float
{
    sort($values);

    return $values[(int) max(0, ceil($percentile * count($values)) - 1)];
}

it('runs a full service day with no data loss', function () {
    mt_srand(20261012);

    // --- Catalogue: plain, own-stock and recipe products ---------------------------------
    $mains = Category::factory()->create(['name' => 'Mains']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $snacks = Category::factory()->create(['name' => 'Snacks']);

    $plain = [
        Product::factory()->forCategory($mains)->create(['name' => 'Tapsilog', 'price_cents' => 18500, 'cost_cents' => 7000]),
        Product::factory()->forCategory($mains)->create(['name' => 'Longsilog', 'price_cents' => 16500, 'cost_cents' => 6000]),
        Product::factory()->forCategory($mains)->create(['name' => 'Sisig', 'price_cents' => 22000, 'cost_cents' => 9000]),
        Product::factory()->forCategory($snacks)->create(['name' => 'Rice Cake', 'price_cents' => 6000, 'cost_cents' => 2000, 'is_vatable' => false]),
        Product::factory()->forCategory($snacks)->create(['name' => 'Turon', 'price_cents' => 3500, 'cost_cents' => 1200]),
    ];
    $water = Product::factory()->forCategory($drinks)->create(['name' => 'Bottled Water', 'price_cents' => 2500, 'cost_cents' => 900, 'track_stock' => true]);
    $soda = Product::factory()->forCategory($drinks)->create(['name' => 'Soda', 'price_cents' => 4500, 'cost_cents' => 2000, 'track_stock' => true]);
    stockUp($water, 2000);
    stockUp($soda, 2000);

    $flour = makeIngredient('Flour', 'g', ['cup' => '120', 'sack' => '25000']);
    $egg = makeIngredient('Egg', 'pc');
    ingredientMovement($flour, StockMovement::TYPE_RECEIPT, '50000.000', 250000);
    ingredientMovement($egg, StockMovement::TYPE_RECEIPT, '1000.000', 800000);

    $pancake = Product::factory()->forCategory($mains)->stockMode(Product::STOCK_RECIPE)->create(['name' => 'Pancake', 'price_cents' => 12000]);
    $combo = Product::factory()->forCategory($mains)->stockMode(Product::STOCK_RECIPE)->create(['name' => 'Pancake Combo', 'price_cents' => 15000]);
    soakRecipe($pancake, [[$flour, '1.000', 'cup', '120.000'], [$egg, '1.000', 'pc', '1.000']]);
    soakRecipe($combo, [[$flour, '100.000', 'g', '100.000'], [$water, '1.000', 'pc', '1.000']]);

    $menu = [...$plain, $water, $soda, $pancake, $combo];

    // --- 3 tablets, each with a cashier, the manager's session and an open shift -----------
    $tablets = [];

    foreach (range(1, 3) as $n) {
        $cashier = userWithRole('cashier', ['name' => "Cashier {$n}"]);
        $installId = newUlid();
        $token = deviceToken($cashier, $installId);
        $device = Device::query()->where('install_id', $installId)->sole();
        $shift = openShift($token, $cashier);

        postCashMovement($token, $shift['ulid'], cashMovementBody($cashier, ['type' => 'in', 'amount_cents' => 50000]))->assertCreated();
        postCashMovement($token, $shift['ulid'], cashMovementBody($cashier, ['type' => 'out', 'amount_cents' => 12500, 'reason' => 'Ice']))->assertCreated();

        $tablets[] = [
            'cashier' => $cashier,
            'token' => $token,
            'managerToken' => deviceToken($this->manager, $installId),
            'device' => $device,
            'shift' => $shift,
            'sequence' => 0,
        ];
    }

    // --- Traffic -----------------------------------------------------------------------
    $orderTimings = [];
    $batchTimings = [];
    $online = [];        // ulid => [tablet index, sale]
    $offlineUlids = [];
    $allUlids = [];
    $expectedPayments = 0;

    $makeSale = function (int $t) use (&$tablets, $menu): array {
        $lines = [];
        $picked = (array) array_rand($menu, mt_rand(1, 3));

        foreach ($picked as $index) {
            $lines[] = [$menu[$index], mt_rand(1, 3)];
        }

        $roll = mt_rand(1, 100);
        $scPwd = $roll <= 5;
        $discount = ! $scPwd && $roll <= 20 ? ['type' => 'promo', 'kind' => 'percent', 'value' => 500] : null;

        return [$lines, soakSale($lines, $tablets[$t]['shift']['ulid'], $discount, $scPwd, mt_rand(1, 100) <= 20)];
    };

    // 420 online orders, round robin over the tablets; one Set cost and one PO receipt mid-service.
    $po = approvedPurchaseOrder($this->manager, $this->owner, [
        prItem($flour, makeSupplier(), '2', 'sack', ['estimated_unit_price_cents' => 130000]),
    ]);

    foreach (range(0, 419) as $i) {
        $t = $i % 3;
        [, $sale] = $makeSale($t);

        soakPostOrder($tablets[$t]['token'], $sale, $orderTimings)->assertCreated();
        $online[$sale['ulid']] = [$t, $sale];
        $allUlids[] = $sale['ulid'];
        $expectedPayments += count($sale['payments']);

        if ($i === 100) {
            postReceipt($this->manager, $po['ulid'], [['po_line_id' => $po['lines'][0]['id'], 'qty' => '2', 'unit' => 'sack']])->assertCreated();
        }

        if ($i === 200) {
            $cost = ['ulid' => newUlid(), 'cost_cents' => 140000, 'unit' => 'sack', 'reason' => 'Supplier price'];
            $this->withToken(tokenFor($this->manager))
                ->postJson("/api/v1/admin/ingredients/{$flour->id}/cost", $cost, ['Idempotency-Key' => $cost['ulid']])
                ->assertOk();
        }

        // A client retry of every 50th sale replays the stored response.
        if ($i % 50 === 0) {
            $this->withToken($tablets[$t]['token'])
                ->postJson('/api/v1/orders', $sale, ['Idempotency-Key' => $sale['ulid']])
                ->assertCreated()
                ->assertHeader('Idempotency-Replayed', 'true');
        }
    }

    // 180 offline orders: 60 per tablet in batches of 25, 25 and 10, each batch replayed once;
    // the first batch of each tablet is retried mid-way, and 2 of each tablet's online sales are
    // sent again offline (a sale committed online just before the connection dropped).
    $alsoOffline = array_slice(array_keys($online), 0, 6);

    foreach ($tablets as $t => &$tablet) {
        $batch = [];

        foreach (range(1, 60) as $k) {
            [$lines, $sale] = $makeSale($t);
            $batch[] = soakOffline($sale, $lines, $tablet['device'], $tablet['cashier'], ++$tablet['sequence']);
            $offlineUlids[] = $sale['ulid'];
            $allUlids[] = $sale['ulid'];
            $expectedPayments += count($sale['payments']);
        }

        foreach (array_chunk($batch, 25) as $c => $chunk) {
            $duplicates = [];

            if ($c === 0) {
                // A mid-batch retry: the first 10 reached the server before the timeout.
                $first = soakSync($tablet['token'], array_slice($chunk, 0, 10), $batchTimings);
                expect(array_unique(array_values($first)))->toBe(['accepted']);
                $duplicates = array_column(array_slice($chunk, 0, 10), 'ulid');

                // Two sales already committed online ride along in the same batch.
                foreach (array_slice($alsoOffline, $t * 2, 2) as $ulid) {
                    [$onlineTablet, $onlineSale] = $online[$ulid];
                    $chunk[] = soakOffline($onlineSale, array_map(fn (array $item) => [Product::query()->findOrFail($item['product_id']), $item['qty']], $onlineSale['items']), $tablet['device'], $tablet['cashier'], ++$tablet['sequence']);
                    $duplicates[] = $ulid;
                }
            }

            $results = soakSync($tablet['token'], $chunk, $batchTimings);

            foreach ($results as $ulid => $status) {
                expect($status)->toBe(in_array($ulid, $duplicates, true) ? 'duplicate' : 'accepted');
            }

            // Every batch is replayed once: all duplicates.
            expect(array_unique(array_values(soakSync($tablet['token'], $chunk, $batchTimings))))->toBe(['duplicate']);
        }
    }
    unset($tablet);

    // --- 10 voids and 15 refunds by the manager, on the tablets ---------------------------
    $candidates = array_values(array_filter(
        $online,
        fn (array $entry) => $entry[1]['sc_pwd'] === null && count($entry[1]['payments']) === 1,
    ));
    $voided = array_slice($candidates, 0, 10);
    $refunded = array_slice($candidates, 10, 15);

    foreach ($voided as [$t, $sale]) {
        $key = newUlid();
        postVoid($tablets[$t]['managerToken'], $sale['ulid'], voidBody(), $key)->assertOk();
        postVoid($tablets[$t]['managerToken'], $sale['ulid'], voidBody(), $key)->assertOk()->assertHeader('Idempotency-Replayed', 'true');
    }

    foreach ($refunded as $r => [$t, $sale]) {
        $order = $this->withToken($tablets[$t]['managerToken'])->getJson("/api/v1/orders/{$sale['ulid']}")->assertOk()->json('data');

        if ($r % 2 === 0) {
            $lines = array_map(fn (array $item) => [$item['id'], $item['qty']], $order['items']);
            $amount = $order['total_cents'];
        } else {
            $item = $order['items'][0];
            $lines = [[$item['id'], 1]];
            $amount = RefundCalculator::lineAmount($item['line_total_cents'], $item['qty'], 0, 1);
        }

        $body = refundBody($tablets[$t]['shift']['ulid'], $lines, [['method' => 'cash', 'amount_cents' => $amount]]);
        postRefund($tablets[$t]['managerToken'], $sale['ulid'], $body)->assertCreated();
        postRefund($tablets[$t]['managerToken'], $sale['ulid'], $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
    }

    // --- Close each shift with the cash the drawer should hold -----------------------------
    foreach ($tablets as $tablet) {
        $ulid = $tablet['shift']['ulid'];
        $cashSales = (int) DB::table('payments')
            ->join('orders', 'orders.id', '=', 'payments.order_id')
            ->where('orders.shift_ulid', $ulid)
            ->where('orders.status', '!=', Order::STATUS_VOIDED)
            ->where('payments.method', 'cash')
            ->sum('payments.amount_cents');
        $cashRefunds = (int) DB::table('refund_payments')
            ->join('refunds', 'refunds.id', '=', 'refund_payments.refund_id')
            ->where('refunds.shift_ulid', $ulid)
            ->where('refund_payments.method', 'cash')
            ->sum('refund_payments.amount_cents');
        $expectedCash = 200000 + 50000 - 12500 + $cashSales - $cashRefunds;

        $report = postClose($tablet['token'], $ulid, closeBody($tablet['cashier'], $expectedCash))->assertOk()->json('data.report');

        $sales = DB::table('orders')->where('shift_ulid', $ulid)->where('status', '!=', Order::STATUS_VOIDED);

        expect($report['orders_count'])->toBe((clone $sales)->count())
            ->and($report['net_sales_cents'])->toBe((int) (clone $sales)->sum('total_cents'))
            ->and($report['voids_count'])->toBe(DB::table('orders')->where('shift_ulid', $ulid)->where('status', Order::STATUS_VOIDED)->count())
            ->and($report['refunds_cents'])->toBe((int) DB::table('refunds')->where('shift_ulid', $ulid)->sum('amount_cents'))
            ->and($report['expected_cash_cents'])->toBe($expectedCash)
            ->and($report['variance_cents'])->toBe(0);
    }

    // --- Afterwards ----------------------------------------------------------------------
    // Zero duplicate orders or payments, and every ULID accounted for.
    expect(count($allUlids))->toBe(600)
        ->and(count(array_unique($allUlids)))->toBe(600)
        ->and(Order::query()->count())->toBe(600)
        ->and(Order::query()->pluck('ulid')->sort()->values()->all())->toBe(collect($allUlids)->sort()->values()->all())
        ->and(Order::query()->whereIn('ulid', $offlineUlids)->where('source', Order::SOURCE_OFFLINE)->count())->toBe(180)
        ->and(DB::table('payments')->count())->toBe($expectedPayments)
        ->and(DB::table('refunds')->count())->toBe(15)
        ->and(Order::query()->where('status', Order::STATUS_VOIDED)->count())->toBe(10)
        ->and(Order::query()->where('needs_review', true)->count())->toBe(0);

    // Σ payments − Σ refund payments = the sales report's net.
    $payments = (int) DB::table('payments')
        ->join('orders', 'orders.id', '=', 'payments.order_id')
        ->where('orders.status', '!=', Order::STATUS_VOIDED)
        ->sum('payments.amount_cents');
    $refundPayments = (int) DB::table('refund_payments')->sum('amount_cents');

    $totals = $this->withToken(tokenFor($this->owner))
        ->getJson('/api/v1/reports/sales?from=2026-10-12&to=2026-10-12&group_by=day')
        ->assertOk()
        ->json('data.totals');

    expect($totals['orders_count'])->toBe(590)
        ->and($totals['net_sales_cents'])->toBe($payments)
        ->and($totals['voids_count'])->toBe(10)
        ->and($totals['refunds_count'])->toBe(15)
        ->and($totals['refunds_cents'])->toBe($refundPayments)
        ->and($totals['net_after_refunds_cents'])->toBe($payments - $refundPayments);

    // The stock ledger (Σ qty_delta = level) and the refund invariants; the ingredient value invariant.
    expectReconciled();
    expectIngredientLedgerConsistent($flour);
    expectIngredientLedgerConsistent($egg);

    // The inventory reports reconcile with the levels.
    $products = collect($this->withToken(tokenFor($this->owner))
        ->getJson('/api/v1/reports/inventory?from=2026-10-12&to=2026-10-12')
        ->assertOk()
        ->json('data.rows'))->keyBy('product_id');

    foreach ([$water, $soda] as $product) {
        $row = $products[$product->id];

        expect($row['closing_qty'])->toBe(stockOf($product))
            ->and($row['opening_qty'] + $row['received'] - $row['sold'] + $row['returned'] - $row['wasted'] + $row['adjusted'])->toBe($row['closing_qty']);
    }

    $ingredients = collect($this->withToken(tokenFor($this->owner))
        ->getJson('/api/v1/reports/inventory?kind=ingredients&from=2026-10-12&to=2026-10-12')
        ->assertOk()
        ->json('data.rows'))->keyBy('name');

    foreach ([$flour, $egg] as $ingredient) {
        $row = $ingredients[$ingredient->name];

        // The value invariant holds up to one centavo of rounding per movement (as in
        // expectIngredientLedgerConsistent): each sale is valued at the rounded average cost.
        $movements = StockMovement::query()->where('ingredient_id', $ingredient->id)->count();

        expect($row['closing_qty'])->toBe((string) ingredientLevel($ingredient)->qty)
            ->and(abs($row['value_in_cents'] - $row['value_out_cents'] - $row['stock_value_cents']))->toBeLessThanOrEqual($movements);
    }

    // The purchasing report reconciles with the receipt.
    $purchasing = $this->withToken(tokenFor($this->owner))
        ->getJson('/api/v1/reports/purchasing?from=2026-10-12&to=2026-10-12')
        ->assertOk()
        ->json('data');

    expect($purchasing['rows'])->toHaveCount(1)
        ->and($purchasing['rows'][0])->toMatchArray(['ordered_qty' => '2.000', 'received_qty' => '2.000', 'remaining_qty' => '0.000', 'line_receiving_status' => 'complete'])
        ->and($purchasing['totals']['received_cents'])->toBe($purchasing['rows'][0]['received_cents'])
        ->and($purchasing['totals']['remaining_cents'])->toBe(0);

    // Timing on the real MySQL.
    $p95 = soakPercentile($orderTimings, 0.95);
    $slowestBatch = max($batchTimings);

    fwrite(STDERR, sprintf("\n  [soak] POST /orders p95 %.1f ms (n=%d); slowest /sync/orders batch %.1f ms (n=%d)\n", $p95, count($orderTimings), $slowestBatch, count($batchTimings)));

    expect($p95)->toBeLessThan(300.0)
        ->and($slowestBatch)->toBeLessThan(2000.0);
})->group('soak');
