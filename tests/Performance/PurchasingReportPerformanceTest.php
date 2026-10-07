<?php

use App\Models\Ingredient;
use App\Models\Supplier;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
| The Ingredients, Recipes & Purchasing criterion (§I): GET /reports/purchasing over a year of
| purchase requests answers in under 500 ms, with set-based SQL and no per-row queries (the median
| of three runs per query). It bulk-inserts ~5,500 PRs with 4 items each (~22,000 rows), most of
| them on POs with lines partly received, so it runs in the `performance` group, excluded from the
| default run:
|
|     php artisan test --group=performance
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-27 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Bulk-inserts a year of purchasing ending 2026-09-26: `$perDay` PRs a day of 4 items each (40
 * ingredients, 12 suppliers). 80% of the PRs are decided (one item in ten declined) with a PO,
 * whose lines are approved and in part received; the rest are pending.
 *
 * @return int The number of PR items
 */
function seedYearOfPurchasing(int $branchId, int $requesterId, int $approverId, int $perDay): int
{
    $suppliers = collect(range(1, 12))->map(fn (int $i) => Supplier::factory()->create(['name' => sprintf('Supplier %02d', $i)])->id)->all();
    $ingredients = collect(range(1, 40))->map(fn (int $i) => Ingredient::factory()->create(['name' => sprintf('Ingredient %02d', $i)])->id)->all();

    $start = CarbonImmutable::parse('2026-09-26')->subDays(364);
    $prSeq = 0;
    $poSeq = 0;
    $items = 0;

    for ($day = 0; $day < 365; $day++) {
        $at = $start->addDays($day)->setTime(2, 0)->toDateTimeString();
        $prs = [];

        for ($n = 0; $n < $perDay; $n++) {
            $prSeq++;
            $decided = $prSeq % 5 !== 0;
            $prs[] = [
                'ulid' => (string) Str::ulid(), 'branch_id' => $branchId, 'pr_no' => sprintf('PR-MAIN-%05d', $prSeq),
                'requested_by' => $requesterId, 'status' => $decided ? 'partially_approved' : 'pending_approval',
                'date_needed' => null, 'remarks' => null, 'cancelled_by' => null, 'cancelled_at' => null,
                'created_at' => $at, 'updated_at' => $at,
            ];
        }

        DB::table('purchase_requests')->insert($prs);
        $prIds = DB::table('purchase_requests')->where('created_at', $at)->orderBy('id')->pluck('id', 'pr_no');

        $itemRows = [];
        $orders = [];

        foreach ($prIds as $prNo => $prId) {
            $seq = (int) substr($prNo, -5);
            $decided = $seq % 5 !== 0;

            for ($k = 0; $k < 4; $k++) {
                $declined = $decided && ($seq + $k) % 10 === 0;
                $itemRows[] = [
                    'purchase_request_id' => $prId, 'branch_id' => $branchId, 'requested_at' => $at, 'ingredient_id' => $ingredients[($seq + $k) % 40], 'product_id' => null,
                    'supplier_id' => $suppliers[($seq + $k) % 12], 'qty' => '2.000', 'unit' => 'kg', 'unit_factor' => '1000.000000000000',
                    'base_qty' => '2000.000', 'estimated_unit_price_cents' => 10000,
                    'remarks' => null, 'decision' => $decided ? ($declined ? 'declined' : 'approved') : 'pending',
                    'decision_reason' => $declined ? 'Enough stock' : null, 'decided_by' => $decided ? $approverId : null,
                    'decided_at' => $decided ? $at : null, 'created_at' => $at, 'updated_at' => $at,
                ];
                $items++;
            }

            if ($decided) {
                $poSeq++;
                $orders[] = [
                    'ulid' => (string) Str::ulid(), 'branch_id' => $branchId, 'po_no' => sprintf('PO-MAIN-%05d', $poSeq),
                    'purchase_request_id' => $prId, 'status' => 'approved', 'receiving_status' => 'partially_received',
                    'created_by' => $approverId, 'approved_by' => $approverId, 'approved_at' => $at,
                    'declined_by' => null, 'declined_at' => null, 'decline_reason' => null, 'expected_delivery_date' => null,
                    'remarks' => null, 'total_cents' => 60000, 'created_at' => $at, 'updated_at' => $at,
                ];
            }
        }

        DB::table('purchase_request_items')->insert($itemRows);
        DB::table('purchase_orders')->insert($orders);
    }

    // One PO line per approved item, received in part (a received line every other one).
    DB::statement(
        'INSERT INTO purchase_order_lines (purchase_order_id, purchase_request_item_id, ingredient_id, product_id, supplier_id, qty, unit, unit_factor, '
        .'base_qty, unit_price_cents, line_total_cents, received_base_qty, received_cents, receiving_status, last_received_at, created_at, updated_at) '
        .'SELECT po.id, pri.id, pri.ingredient_id, NULL, pri.supplier_id, pri.qty, pri.unit, pri.unit_factor, pri.base_qty, 10000, 20000, '
        .'CASE WHEN pri.id % 2 = 0 THEN 2000 ELSE 0 END, CASE WHEN pri.id % 2 = 0 THEN 20000 ELSE 0 END, '
        ."CASE WHEN pri.id % 2 = 0 THEN 'complete' ELSE 'pending' END, CASE WHEN pri.id % 2 = 0 THEN pri.created_at END, pri.created_at, pri.created_at "
        ."FROM purchase_request_items pri JOIN purchase_orders po ON po.purchase_request_id = pri.purchase_request_id WHERE pri.decision = 'approved'",
    );

    // Each approved item's link to its line, as DecidePurchaseRequestAction writes it.
    DB::statement('UPDATE purchase_request_items pri JOIN purchase_order_lines pol ON pol.purchase_request_item_id = pri.id SET pri.purchase_order_line_id = pol.id');

    return $items;
}

it('answers the purchasing report over a year of purchasing in under 500 ms, with set-based SQL', function () {
    $seeded = seedYearOfPurchasing($this->branch->id, $this->manager->id, $this->owner->id, 15);

    expect($seeded)->toBeGreaterThan(20000);

    DB::statement('ANALYZE TABLE purchase_requests, purchase_request_items, purchase_orders, purchase_order_lines, suppliers, ingredients, users');

    $token = tokenFor($this->owner);
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

    $results = [];

    foreach ([
        'year' => 'from=2025-09-27&to=2026-09-26',
        'month' => 'from=2026-08-27&to=2026-09-26',
        'year, filtered' => 'from=2025-09-27&to=2026-09-26&decision=approved&receiving_status=pending',
    ] as $label => $query) {
        $timings = [];

        foreach (range(1, 3) as $run) {
            DB::flushQueryLog();
            DB::enableQueryLog();

            $started = hrtime(true);
            $response = $this->withToken($token)->getJson('/api/v1/reports/purchasing?'.$query)->assertOk();
            $timings[] = (hrtime(true) - $started) / 1e6;

            $log = DB::getQueryLog();
            DB::disableQueryLog();
        }

        sort($timings);

        $results[$label] = [
            'runs_ms' => array_map(fn (float $t) => round($t, 1), $timings),
            'ms' => round($timings[1], 1),
            'queries' => count($log),
            'rows' => count($response->json('data.rows')),
            'items' => $response->json('data.totals.items'),
            'truncated' => $response->json('meta.truncated'),
        ];
    }

    fwrite(STDERR, PHP_EOL."GET /reports/purchasing over {$seeded} PR items: ".json_encode($results, JSON_PRETTY_PRINT).PHP_EOL);

    expect($results['year']['items'])->toBe($seeded)
        ->and($results['year']['rows'])->toBe(500)
        ->and($results['year']['truncated'])->toBeTrue();

    foreach ($results as $label => $result) {
        expect($result['queries'])->toBeLessThanOrEqual(8, "{$label}: no per-row queries")
            ->and($result['ms'])->toBeLessThan(500.0, "{$label} took {$result['ms']} ms");
    }
})->group('performance');
