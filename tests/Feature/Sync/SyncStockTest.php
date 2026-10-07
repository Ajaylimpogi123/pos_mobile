<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-26 03:00:00');

    $this->cashier = userWithRole('cashier');

    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $make = fn (array $attributes = []) => Product::factory()->forCategory($drinks)->create($attributes);

    $this->icedTea = $make(['name' => 'Iced Tea', 'track_stock' => true]);
    $this->water = $make(['name' => 'Bottled Water', 'track_stock' => true]);
    $this->soda = $make(['name' => 'Soda', 'track_stock' => true]);
    $this->hotDog = $make(['name' => 'Hot Dog', 'track_stock' => false]);
});

afterEach(function () {
    Carbon::setTestNow();
});

describe('GET /sync/stock', function () {
    it('returns every tracked product of the branch ordered by id, a missing level as 0, and server_time', function () {
        stockUp($this->icedTea, 48);
        stockUp($this->water, 30);

        $response = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/sync/stock')->assertOk();

        expect($response->json())->toBe(['data' => [
            'levels' => [
                ['product_id' => $this->icedTea->id, 'qty' => 48, 'reorder_level' => null],
                ['product_id' => $this->water->id, 'qty' => 30, 'reorder_level' => null],
                ['product_id' => $this->soda->id, 'qty' => 0, 'reorder_level' => null],
            ],
            'recipes' => [],
            'server_time' => '2026-09-26T03:00:00Z',
        ]]);
    });

    it('returns a negative level as a negative integer', function () {
        stockUp($this->icedTea, 2);
        stockUp($this->icedTea, -5);

        $levels = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/sync/stock')->assertOk()->json('data.levels');

        expect($levels[0])->toBe(['product_id' => $this->icedTea->id, 'qty' => -3, 'reorder_level' => null]);
    });

    it('carries each product\'s reorder level in the caller\'s branch, null when unset (Inventory)', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        stockUp($this->icedTea, 9);
        StockLevel::query()->where('product_id', $this->icedTea->id)->update(['reorder_level' => 10]);
        stockUp($this->water, 5, $north);
        StockLevel::query()->where('product_id', $this->water->id)->update(['reorder_level' => 3]);
        // A level row with a reorder level but no stock yet.
        StockLevel::query()->insert([
            'branch_id' => $this->branch->id, 'product_id' => $this->soda->id, 'qty' => 0, 'reorder_level' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $levels = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/sync/stock')->assertOk()->json('data.levels');

        expect($levels)->toBe([
            ['product_id' => $this->icedTea->id, 'qty' => 9, 'reorder_level' => 10],
            ['product_id' => $this->water->id, 'qty' => 0, 'reorder_level' => null],
            ['product_id' => $this->soda->id, 'qty' => 0, 'reorder_level' => 0],
        ]);
    });

    it('leaves out deleted products and products that do not track stock', function () {
        stockUp($this->water, 10);
        $this->water->delete();
        $this->soda->update(['track_stock' => false]);

        $levels = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/sync/stock')->assertOk()->json('data.levels');

        expect(array_column($levels, 'product_id'))->toBe([$this->icedTea->id]);
    });

    it('covers the caller\'s branch only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        stockUp($this->icedTea, 48);
        stockUp($this->icedTea, 7, $north);
        stockUp($this->water, 9, $north);

        $northCashier = User::factory()->forBranch($north)->withRole('cashier')->create();

        $main = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/sync/stock')->assertOk()->json('data.levels');
        $northLevels = $this->withToken(tokenFor($northCashier))->getJson('/api/v1/sync/stock')->assertOk()->json('data.levels');

        expect(array_column($main, 'qty', 'product_id'))->toBe([
            $this->icedTea->id => 48, $this->water->id => 0, $this->soda->id => 0,
        ])
            ->and(array_column($northLevels, 'qty', 'product_id'))->toBe([
                $this->icedTea->id => 7, $this->water->id => 9, $this->soda->id => 0,
            ]);
    });

    it('returns an empty list when nothing tracks stock', function () {
        // Round B: `track_stock` is derived from `stock_mode` (a generated column).
        Product::query()->update(['stock_mode' => Product::STOCK_NONE]);

        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/sync/stock')
            ->assertOk()
            ->assertExactJson(['data' => ['levels' => [], 'recipes' => [], 'server_time' => '2026-09-26T03:00:00Z']]);
    });

    it('is open to every role', function (string $role) {
        $this->withToken(tokenFor(userWithRole($role)))->getJson('/api/v1/sync/stock')->assertOk();
    })->with(['owner', 'manager', 'cashier']);

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/sync/stock')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});
