<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-27 05:10:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);

    // Priced, costed and pictured, so no catalogue insight gets in the way.
    $this->make = fn (string $name, bool $tracked = true) => Product::factory()->forCategory($this->drinks)->create([
        'name' => $name, 'price_cents' => 5000, 'cost_cents' => 1000, 'image_path' => 'x.webp', 'track_stock' => $tracked,
    ]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * The dashboard's stock insights for the user, keyed by insight key.
 *
 * @return array<string, array<string, mixed>>
 */
function stockInsights(User $user): array
{
    $insights = test()->withToken(tokenFor($user))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights');

    return collect($insights)->whereIn('key', ['stock_out', 'stock_low'])->keyBy('key')->all();
}

describe('insights stock_out and stock_low', function () {
    it('counts out and low products by the stock status, out first', function () {
        $out1 = ($this->make)('Soda');                         // never stocked
        $out2 = ($this->make)('Juice');
        stockUp($out2, 2);
        stockUp($out2, -2);                                     // back to 0
        $out3 = ($this->make)('Cola');
        stockUp($out3, -1);                                     // negative
        setReorderLevel($out3, 5);                              // out, not also low
        $low1 = ($this->make)('Iced Tea');
        stockUp($low1, 10);
        setReorderLevel($low1, 10);                             // at the level: low
        $low2 = ($this->make)('Water');
        stockUp($low2, 3);
        setReorderLevel($low2, 4);
        $ok = ($this->make)('Milk');
        stockUp($ok, 11);
        setReorderLevel($ok, 10);
        ($this->make)('Hot Dog', tracked: false);               // untracked: ignored
        ($this->make)('Gone')->delete();                        // deleted: ignored

        $insights = test()->withToken(tokenFor($this->manager))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights');

        // Critical first, then the warnings by key (so `staff_without_pin` may sit between them).
        expect($insights[0]['key'])->toBe('stock_out')
            ->and(array_values(array_filter($insights, fn (array $i) => str_starts_with($i['key'], 'stock_'))))->toBe([
                [
                    'key' => 'stock_out', 'severity' => 'critical', 'title' => '3 products are out of stock',
                    'message' => 'Stock in these products or mark them unavailable.', 'count' => 3, 'action' => 'inventory.alerts',
                ],
                [
                    'key' => 'stock_low', 'severity' => 'warning', 'title' => '2 products are running low',
                    'message' => 'Reorder these products before they run out.', 'count' => 2, 'action' => 'inventory.alerts',
                ],
            ]);
    });

    it('uses the singular for one product, and leaves out a zero count', function () {
        $soda = ($this->make)('Soda');
        stockUp($soda, 5);
        setReorderLevel($soda, 5);

        expect(stockInsights($this->manager))->toHaveKeys(['stock_low'])->not->toHaveKey('stock_out')
            ->and(stockInsights($this->manager)['stock_low']['title'])->toBe('1 product is running low');

        setReorderLevel($soda, null);
        stockUp($soda, -5);

        $insights = stockInsights($this->manager);
        expect($insights)->not->toHaveKey('stock_low')
            ->and($insights['stock_out']['title'])->toBe('1 product is out of stock');

        stockUp($soda, 1);
        expect(stockInsights($this->manager))->toBe([]);
    });

    it('is shown with inventory.adjust or report.view only', function () {
        ($this->make)('Soda');

        $clerk = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('clerk', ['inventory.adjust'])->id]);
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);

        expect(stockInsights($clerk))->toHaveKey('stock_out')
            ->and(stockInsights($viewer))->toHaveKey('stock_out')
            ->and(stockInsights(userWithRole('owner')))->toHaveKey('stock_out')
            ->and(stockInsights(userWithRole('cashier')))->toBe([]);
    });

    it('counts the caller\'s branch only', function () {
        $soda = ($this->make)('Soda');
        stockUp($soda, 5);
        $northManager = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('manager')->create();

        expect(stockInsights($this->manager))->toBe([])
            ->and(stockInsights($northManager)['stock_out']['count'])->toBe(1);
    });
});

describe('activity summaries of stock entries', function () {
    it('words stock in, wastage, counts, adjustments and reorder levels', function () {
        $tea = ($this->make)('Iced Tea');
        stockUp($tea, 35);
        $token = tokenFor($this->manager);
        $adjust = fn (array $body) => $this->withToken($token)->postJson(
            "/api/v1/admin/products/{$tea->id}/stock-adjustments",
            $body,
            ['Idempotency-Key' => $body['ulid']],
        )->assertCreated();

        $adjust(['ulid' => newUlid(), 'type' => 'count', 'counted_qty' => 33, 'reason' => 'Count']);
        $adjust(['ulid' => newUlid(), 'type' => 'receipt', 'qty_delta' => 24]);
        $adjust(['ulid' => newUlid(), 'type' => 'wastage', 'qty_delta' => -1, 'reason' => 'Spoiled']);
        $adjust(['ulid' => newUlid(), 'qty_delta' => 2, 'reason' => 'Found']);
        $this->withToken($token)->putJson("/api/v1/inventory/{$tea->id}/reorder-level", ['reorder_level' => 10])->assertOk();
        $this->withToken($token)->putJson("/api/v1/inventory/{$tea->id}/reorder-level", ['reorder_level' => null])->assertOk();

        $summaries = array_column(
            $this->withToken($token)->getJson('/api/v1/dashboard')->assertOk()->json('data.activity.recent_changes'),
            'summary',
        );

        expect(array_slice($summaries, 0, 6))->toBe([
            'Removed reorder level of "Iced Tea"',
            'Set reorder level of "Iced Tea" to 10',
            'Adjusted stock of "Iced Tea" (+2)',
            'Wasted 1 "Iced Tea"',
            'Received 24 "Iced Tea"',
            'Counted "Iced Tea" (35 → 33)',
        ]);
    });
});
