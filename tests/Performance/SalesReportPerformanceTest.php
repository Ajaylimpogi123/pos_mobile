<?php

use App\Models\Category;
use App\Models\Device;
use App\Models\Product;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
| The PROJECT_MEMORY exit criterion for reports: every `group_by` of GET /reports/sales over
| a full year of seeded sales answers in under 500 ms, with a fixed, set-based number of
| queries. It seeds ~30,000 orders (with ~90,000 lines and ~33,000 payments) by bulk insert,
| plus (Phase 7) a voided order in every 50 and a one-line refund of every other 20th order
| (~600 voids, ~1,500 refunds with their lines and payments), so it runs in its own group,
| excluded from the default run:
|
|     php artisan test --group=performance
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Bulk-inserts `$perDay` completed orders on each of the 365 business days ending
 * 2026-09-26: 3 lines each (from 40 products in 5 categories), rung up by 4 cashiers, paid in
 * cash (with change) or GCash, or split. Phase 7: every 50th order is voided, and every other
 * 20th order has one unit of its first line refunded in cash on its business day.
 *
 * @return array{orders: int, voids: int, refunds: int}
 */
function seedYearOfSales(int $branchId, int $perDay): array
{
    $device = Device::factory()->create(['branch_id' => $branchId]);
    $itemId = (int) DB::table('order_items')->max('id') + 1;
    $refundId = (int) DB::table('refunds')->max('id') + 1;
    $voids = $refundCount = 0;

    $cashiers = collect(range(1, 4))->map(fn (int $i) => userWithRole('cashier', ['name' => "Cashier {$i}"]))->all();
    $categories = collect(range(1, 5))->map(fn (int $i) => Category::factory()->create(['name' => "Category {$i}"]))->all();
    $products = collect(range(0, 39))
        ->map(fn (int $i) => Product::factory()->forCategory($categories[$i % 5])->create([
            'name' => "Product {$i}",
            'price_cents' => 2500 + 250 * $i,
            'is_vatable' => $i % 4 !== 0,
        ]))
        ->all();

    $orderId = (int) DB::table('orders')->max('id') + 1;
    $invoice = 1;
    $now = now()->toDateTimeString();
    $orders = $items = $payments = $refunds = $refundItems = $refundPayments = [];

    $flush = function (bool $force = false) use (&$orders, &$items, &$payments, &$refunds, &$refundItems, &$refundPayments): void {
        if (! $force && count($orders) < 1000) {
            return;
        }

        $tables = [
            'orders' => $orders, 'order_items' => $items, 'payments' => $payments,
            'refunds' => $refunds, 'refund_items' => $refundItems, 'refund_payments' => $refundPayments,
        ];

        foreach ($tables as $table => $rows) {
            foreach (array_chunk($rows, 1000) as $chunk) {
                DB::table($table)->insert($chunk);
            }
        }

        $orders = $items = $payments = $refunds = $refundItems = $refundPayments = [];
    };

    $start = CarbonImmutable::parse('2026-09-26')->subDays(364);

    for ($day = 0; $day < 365; $day++) {
        $date = $start->addDays($day)->toDateString();

        for ($n = 1; $n <= $perDay; $n++) {
            $subtotal = $vatable = $itemsQty = 0;
            $voided = $orderId % 50 === 0;
            $refunded = ! $voided && $orderId % 20 === 0;
            $firstItem = null;

            foreach ([0, 1, 2] as $line) {
                $product = $products[($orderId * 7 + $line * 13) % 40];
                $qty = 1 + ($orderId + $line) % 3;
                $gross = $product->price_cents * $qty;
                $subtotal += $gross;
                $itemsQty += $qty;
                $vatable += $product->is_vatable ? $gross : 0;

                $firstItem ??= ['id' => $itemId, 'product' => $product];

                $items[] = [
                    'id' => $itemId++, 'order_id' => $orderId, 'branch_id' => $branchId, 'business_date' => $date, 'product_id' => $product->id, 'category_id' => $product->category_id,
                    'product_name' => $product->name, 'category_name' => $product->category->name,
                    'sku' => null, 'unit_price_cents' => $product->price_cents, 'unit_cost_cents' => 1000,
                    'is_vatable' => $product->is_vatable, 'qty' => $qty, 'gross_cents' => $gross,
                    'discount_type' => 'none', 'line_discount_cents' => 0, 'order_discount_share_cents' => 0,
                    'line_total_cents' => $gross, 'created_at' => $now, 'updated_at' => $now,
                ];
            }

            $vatableSales = intdiv($vatable * 10000 + 5600, 11200);

            $orders[] = [
                'id' => $orderId, 'ulid' => (string) Str::ulid(), 'branch_id' => $branchId,
                'user_id' => $cashiers[$orderId % 4]->id, 'invoice_no' => sprintf('INV-MAIN-%08d', $invoice++),
                'queue_no' => $n, 'items_qty' => $itemsQty, 'business_date' => $date, 'status' => $voided ? 'voided' : ($refunded ? 'partially_refunded' : 'completed'), 'source' => 'online',
                'subtotal_cents' => $subtotal, 'line_discounts_cents' => 0, 'discount_type' => 'none',
                'order_discount_cents' => 0, 'discount_cents' => 0, 'total_cents' => $subtotal,
                'vatable_sales_cents' => $vatableSales, 'vat_amount_cents' => $vatable - $vatableSales,
                'vat_exempt_sales_cents' => $subtotal - $vatable, 'tendered_cents' => $subtotal, 'change_cents' => 0,
                'client_total_cents' => $subtotal, 'has_total_mismatch' => false, 'needs_review' => false,
                'placed_at' => "{$date} 06:00:00", 'created_at' => $now, 'updated_at' => $now,
            ];

            $voids += $voided ? 1 : 0;

            if ($refunded) {
                // One unit of the first line: rhu(T × 1, n) is its unit price (no discounts).
                $amount = $firstItem['product']->price_cents;
                $refundCount++;

                $refunds[] = [
                    'id' => $refundId, 'ulid' => (string) Str::ulid(), 'order_id' => $orderId, 'branch_id' => $branchId,
                    'business_date' => $date, 'shift_ulid' => (string) Str::ulid(), 'device_id' => $device->id,
                    'refunded_by' => $cashiers[0]->id, 'authorized_by' => null, 'reason' => 'Seeded',
                    'amount_cents' => $amount, 'vatable_sales_cents' => 0, 'vat_amount_cents' => 0, 'vat_exempt_sales_cents' => $amount,
                    'refunded_at' => "{$date} 07:00:00", 'created_at' => $now, 'updated_at' => $now,
                ];
                $refundItems[] = [
                    'refund_id' => $refundId, 'order_item_id' => $firstItem['id'], 'branch_id' => $branchId, 'business_date' => $date,
                    'product_id' => $firstItem['product']->id, 'category_id' => $firstItem['product']->category_id,
                    'qty' => 1, 'amount_cents' => $amount, 'created_at' => $now, 'updated_at' => $now,
                ];
                $refundPayments[] = [
                    'refund_id' => $refundId, 'branch_id' => $branchId, 'business_date' => $date, 'method' => 'cash',
                    'amount_cents' => $amount, 'reference_no' => null, 'created_at' => $now, 'updated_at' => $now,
                ];
                $refundId++;
            }

            if ($orderId % 10 === 0) {
                $payments[] = ['order_id' => $orderId, 'branch_id' => $branchId, 'business_date' => $date, 'method' => 'gcash', 'amount_cents' => 1000, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'G', 'created_at' => $now, 'updated_at' => $now];
                $payments[] = ['order_id' => $orderId, 'branch_id' => $branchId, 'business_date' => $date, 'method' => 'cash', 'amount_cents' => $subtotal - 1000, 'tendered_cents' => $subtotal, 'change_cents' => 1000, 'reference_no' => null, 'created_at' => $now, 'updated_at' => $now];
            } elseif ($orderId % 3 === 0) {
                $payments[] = ['order_id' => $orderId, 'branch_id' => $branchId, 'business_date' => $date, 'method' => 'gcash', 'amount_cents' => $subtotal, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'G', 'created_at' => $now, 'updated_at' => $now];
            } else {
                $payments[] = ['order_id' => $orderId, 'branch_id' => $branchId, 'business_date' => $date, 'method' => 'cash', 'amount_cents' => $subtotal, 'tendered_cents' => $subtotal + 500, 'change_cents' => 500, 'reference_no' => null, 'created_at' => $now, 'updated_at' => $now];
            }

            $orderId++;
            $flush();
        }
    }

    $flush(true);

    return ['orders' => $invoice - 1, 'voids' => $voids, 'refunds' => $refundCount];
}

it('answers every group_by over a year of sales, voids and refunds in under 500 ms, with two report queries', function () {
    $seeded = seedYearOfSales($this->branch->id, 82);

    expect($seeded['orders'])->toBe(29930)
        ->and(DB::table('order_items')->count())->toBe(29930 * 3)
        ->and($seeded['voids'])->toBeGreaterThan(500)
        ->and($seeded['refunds'])->toBeGreaterThan(1000)
        ->and(DB::table('refunds')->count())->toBe($seeded['refunds'])
        ->and(DB::table('refund_items')->count())->toBe($seeded['refunds']);

    // Committed data: refresh the optimizer statistics, as production tables have them.
    analyzeTables('orders', 'order_items', 'payments', 'users', 'refunds', 'refund_items', 'refund_payments');

    $token = tokenFor($this->owner);
    $query = 'from=2025-09-27&to=2026-09-26&group_by=';

    // Warm up the framework and the connection (not the report's own queries' plans).
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

    $results = [];

    foreach (['day', 'product', 'category', 'payment', 'cashier'] as $group) {
        DB::flushQueryLog();
        DB::enableQueryLog();

        $started = hrtime(true);
        $response = $this->withToken($token)->getJson('/api/v1/reports/sales?'.$query.$group)->assertOk();
        $ms = (hrtime(true) - $started) / 1e6;

        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $reportQueries = array_values(array_filter($log, fn (array $q) => str_contains($q['query'], DB::getQueryGrammar()->wrapTable('orders'))));

        $results[$group] = [
            'ms' => round($ms, 1),
            'queries' => count($log),
            'report_queries' => count($reportQueries),
            'report_sql_ms' => array_map(fn (array $q) => round((float) $q['time'], 1), $reportQueries),
            'orders_count' => $response->json('data.totals.orders_count'),
            'voids_count' => $response->json('data.totals.voids_count'),
            'refunds_count' => $response->json('data.totals.refunds_count'),
        ];
    }

    fwrite(STDERR, PHP_EOL.'GET /reports/sales over 365 days, 29,930 orders with voids and refunds: '.json_encode($results, JSON_PRETTY_PRINT).PHP_EOL);

    foreach ($results as $group => $result) {
        expect($result['orders_count'] + $result['voids_count'])->toBe(29930)
            ->and($result['voids_count'])->toBe($seeded['voids'])
            ->and($result['refunds_count'])->toBe($seeded['refunds'])
            ->and($result['report_queries'])->toBe(2, "{$group}: two report queries")
            ->and($result['queries'])->toBeLessThanOrEqual(8, "{$group}: no per-row queries")
            ->and($result['ms'])->toBeLessThan(500.0, "{$group} took {$result['ms']} ms");
    }
})->group('performance');
