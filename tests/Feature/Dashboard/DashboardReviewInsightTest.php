<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->cashier = userWithRole('cashier');
    $this->manager = userWithRole('manager');

    $this->hotDog = Product::factory()->forCategory(Category::factory()->create())->create(['price_cents' => 8000, 'cost_cents' => 1000, 'image_path' => 'x.webp']);

    $this->deviceToken = deviceToken($this->cashier);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Sync the given number of offline sales paid short (so each needs review).
 */
function syncShortSales(int $count): void
{
    $orders = array_map(fn () => offlineOrder(test()->cashier, [[test()->hotDog, 1]], [
        'payments' => [['method' => 'cash', 'amount_cents' => 100, 'reference_no' => null]],
    ]), range(1, $count));

    syncOrders(test()->deviceToken, $orders)->assertOk();
}

/**
 * @return array<string, mixed>|null
 */
function reviewInsight(User $user): ?array
{
    $insights = test()->withToken(tokenFor($user))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights');

    return collect($insights)->firstWhere('key', 'orders_need_review');
}

describe('insight orders_need_review', function () {
    it('counts the branch\'s orders that need review', function () {
        syncShortSales(3);

        expect(reviewInsight($this->manager))->toBe([
            'key' => 'orders_need_review',
            'severity' => 'warning',
            'title' => '3 offline sales need review',
            'message' => 'Check these sales and mark them reviewed.',
            'count' => 3,
            'action' => 'orders.review',
        ]);
    });

    it('uses the singular for one sale', function () {
        syncShortSales(1);

        expect(reviewInsight($this->manager)['title'])->toBe('1 offline sale needs review');
    });

    it('drops reviewed orders, and is absent at zero', function () {
        syncShortSales(2);
        $ulids = Order::query()->pluck('ulid');

        $this->withToken(tokenFor($this->manager))->postJson("/api/v1/orders/{$ulids[0]}/review")->assertOk();
        expect(reviewInsight($this->manager)['count'])->toBe(1);

        $this->withToken(tokenFor($this->manager))->postJson("/api/v1/orders/{$ulids[1]}/review")->assertOk();
        expect(reviewInsight($this->manager))->toBeNull();
    });

    it('is hidden without the sales section (report.view)', function () {
        syncShortSales(1);

        expect(reviewInsight($this->cashier))->toBeNull();
    });

    it('counts the caller\'s branch only', function () {
        syncShortSales(2);
        $northManager = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('manager')->create();

        expect(reviewInsight($northManager))->toBeNull();
    });

    it('sorts with the other warnings by key', function () {
        syncShortSales(1);
        Product::factory()->forCategory(Category::factory()->create())->create(['cost_cents' => 0, 'image_path' => 'y.webp']);

        $keys = array_column(
            $this->withToken(tokenFor($this->manager))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights'),
            'key',
        );

        expect(array_search('orders_need_review', $keys, true))->toBeLessThan(array_search('products_without_cost', $keys, true));
    });
});
