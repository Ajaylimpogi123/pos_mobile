<?php

use App\Models\Category;
use App\Models\Product;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
| The Inventory (v1 completion) criterion: GET /reports/inventory over a full year of seeded
| stock movements answers in under 500 ms, with one set-based movement query and no per-row
| queries (the median of three runs per query). It seeds ~155,000 movements of every type
| across 60 tracked products by bulk insert, so it runs in the `performance` group, excluded
| from the default run:
|
|     php artisan test --group=performance
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-27 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
});

afterEach(function () {
    Carbon::setTestNow();

    // The seeded ledger is committed (DatabaseMigrations). Clear it before the rollback: the
    // movement-type migrations refuse to drop a type the ledger still uses, by design. TRUNCATE
    // (nothing references the ledger) leaves no purge work to slow the next benchmark.
    DB::table('stock_movements')->truncate();
});

/**
 * Bulk-inserts a year of movements ending 2026-09-26 for 60 tracked products in 6
 * categories: `$salesPerDay` sale movements a day, a stock in of every product each Monday,
 * a void every 50th sale and a refund every 40th, a wastage and a count a day, a weekly
 * adjustment, and an opening per product on the first day. The levels are set to the ledger
 * sums, as the real writers keep them.
 *
 * @return int The number of movements
 */
function seedYearOfMovements(int $branchId, int $salesPerDay): int
{
    $categories = collect(range(1, 6))->map(fn (int $i) => Category::factory()->create(['name' => "Category {$i}"]))->all();
    $products = collect(range(0, 59))
        ->map(fn (int $i) => Product::factory()->forCategory($categories[$i % 6])->create([
            'name' => sprintf('Product %02d', $i), 'track_stock' => true, 'cost_cents' => 500 + 10 * $i,
        ]))
        ->all();

    $now = now()->toDateTimeString();
    $rows = [];
    $count = 0;

    $push = function (Product $product, string $type, int $qty, string $at) use (&$rows, &$count, $branchId, $now): void {
        $rows[] = [
            'ulid' => (string) Str::ulid(), 'branch_id' => $branchId, 'product_id' => $product->id, 'type' => $type,
            'qty_delta' => $qty, 'unit_cost_cents' => $product->cost_cents, 'reference_type' => null, 'reference_id' => null,
            'reason' => null, 'occurred_at' => $at, 'created_by' => null, 'created_at' => $now, 'updated_at' => $now,
        ];
        $count++;

        if (count($rows) >= 2000) {
            DB::table('stock_movements')->insert($rows);
            $rows = [];
        }
    };

    $start = CarbonImmutable::parse('2026-09-26')->subDays(364);

    foreach ($products as $product) {
        $push($product, 'opening', 500, $start->toDateString().' 00:00:00');
    }

    $sale = 0;

    for ($day = 0; $day < 365; $day++) {
        $date = $start->addDays($day);
        $d = $date->toDateString();

        if ($date->isMonday()) {
            foreach ($products as $product) {
                $push($product, 'receipt', 60, "{$d} 00:30:00");
            }
        }

        for ($n = 0; $n < $salesPerDay; $n++) {
            $sale++;
            $product = $products[($sale * 7) % 60];
            $at = sprintf('%s %02d:%02d:00', $d, 1 + intdiv($n, 60) % 12, $n % 60);
            $push($product, 'sale', -(1 + $sale % 3), $at);

            if ($sale % 50 === 0) {
                $push($product, 'void', 1 + $sale % 3, $at);
            } elseif ($sale % 40 === 0) {
                $push($product, 'refund', 1, $at);
            }
        }

        $push($products[$day % 60], 'wastage', -1, "{$d} 13:00:00");
        $push($products[($day + 30) % 60], 'count', ($day % 5) - 2 ?: 1, "{$d} 13:30:00");

        if ($day % 7 === 3) {
            $push($products[$day % 60], 'adjustment', 2, "{$d} 14:00:00");
        }
    }

    if ($rows !== []) {
        DB::table('stock_movements')->insert($rows);
    }

    DB::statement(
        'INSERT INTO stock_levels (branch_id, product_id, qty, created_at, updated_at) '
        .'SELECT branch_id, product_id, SUM(qty_delta), NOW(), NOW() FROM stock_movements WHERE branch_id = ? GROUP BY branch_id, product_id',
        [$branchId],
    );
    DB::table('stock_levels')->where('product_id', $products[0]->id)->update(['reorder_level' => 100000]);

    return $count;
}

it('answers the inventory report over a year of movements in under 500 ms, with one movement query', function () {
    $seeded = seedYearOfMovements($this->branch->id, 400);

    expect($seeded)->toBeGreaterThan(150000)
        ->and(DB::table('stock_movements')->count())->toBe($seeded);

    // Committed data: refresh the optimizer statistics, as production tables have them.
    DB::statement('ANALYZE TABLE stock_movements, stock_levels, products, categories');

    $token = tokenFor($this->owner);

    // Warm up the framework and the connection.
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

    $results = [];

    foreach ([
        'year' => 'from=2025-09-27&to=2026-09-26',
        'month' => 'from=2026-08-27&to=2026-09-26',
        'day, alerts' => 'from=2026-09-26&to=2026-09-26&status=alerts',
    ] as $label => $query) {
        // Three timed runs, judged by the median, so one hiccup of a shared dev machine
        // doesn't decide the result (each run is still a full, cold-parameter request).
        $timings = [];

        foreach (range(1, 3) as $run) {
            DB::flushQueryLog();
            DB::enableQueryLog();

            $started = hrtime(true);
            $response = $this->withToken($token)->getJson('/api/v1/reports/inventory?'.$query)->assertOk();
            $timings[] = (hrtime(true) - $started) / 1e6;

            $log = DB::getQueryLog();
            DB::disableQueryLog();
        }

        sort($timings);
        $ms = $timings[1];

        $movementQueries = array_values(array_filter($log, fn (array $q) => str_contains($q['query'], '`stock_movements`')));

        $results[$label] = [
            'runs_ms' => array_map(fn (float $t) => round($t, 1), $timings),
            'ms' => round($ms, 1),
            'queries' => count($log),
            'movement_queries' => count($movementQueries),
            'movement_sql_ms' => array_map(fn (array $q) => round((float) $q['time'], 1), $movementQueries),
            'rows' => count($response->json('data.rows')),
            'sold' => $response->json('data.totals.sold'),
            'alerts' => $response->json('data.totals.low') + $response->json('data.totals.out'),
        ];

        foreach ($response->json('data.rows') as $row) {
            expect($row['opening_qty'] + $row['received'] - $row['sold'] + $row['returned'] - $row['wasted'] + $row['adjusted'])
                ->toBe($row['closing_qty']);
        }
    }

    fwrite(STDERR, PHP_EOL."GET /reports/inventory over {$seeded} movements: ".json_encode($results, JSON_PRETTY_PRINT).PHP_EOL);

    expect($results['year']['rows'])->toBe(60)
        ->and($results['day, alerts']['rows'])->toBe($results['day, alerts']['alerts']);

    foreach ($results as $label => $result) {
        expect($result['movement_queries'])->toBe(1, "{$label}: one movement query")
            ->and($result['queries'])->toBeLessThanOrEqual(8, "{$label}: no per-row queries")
            ->and($result['ms'])->toBeLessThan(500.0, "{$label} took {$result['ms']} ms");
    }

    // The closing stock of a year that ends today is the level on hand.
    $levels = DB::table('stock_levels')->pluck('qty', 'product_id')->map(fn ($qty) => (int) $qty)->all();
    $closing = collect($this->withToken($token)->getJson('/api/v1/reports/inventory?from=2025-09-27&to=2026-09-27')->json('data.rows'))
        ->pluck('closing_qty', 'product_id')->all();

    ksort($closing);
    ksort($levels);
    expect($closing)->toBe($levels);
})->group('performance');
