<?php

use App\Models\Category;
use App\Models\Product;
use Database\Seeders\DevSeeder;

beforeEach(function () {
    seedRoles();
});

it('seeds the contract\'s dev catalogue in the local environment, idempotently', function () {
    app()['env'] = 'local';

    $this->seed(DevSeeder::class);
    $this->seed(DevSeeder::class);

    expect(Category::query()->orderBy('sort_order')->get(['name', 'sort_order', 'is_active'])->toArray())->toBe([
        ['name' => 'Breakfast', 'sort_order' => 10, 'is_active' => true],
        ['name' => 'Meals', 'sort_order' => 20, 'is_active' => true],
        ['name' => 'Drinks', 'sort_order' => 30, 'is_active' => true],
    ]);

    $products = Product::query()->with('category')->orderBy('sku')->get()->map(fn (Product $p) => [
        $p->category->name, $p->sku, $p->name, $p->price_cents, $p->cost_cents, $p->track_stock, $p->is_available, $p->image_path,
    ])->all();

    expect($products)->toBe([
        ['Breakfast', 'BRK-001', 'Egg with Rice', 5000, 2250, false, true, null],
        ['Breakfast', 'BRK-002', 'Hot Dog', 8000, 3600, false, true, null],
        ['Drinks', 'DRK-001', 'Iced Tea', 3500, 1575, true, true, null],
        ['Drinks', 'DRK-002', 'Bottled Water', 2000, 900, true, true, null],
        ['Meals', 'MEA-001', 'Fried Chicken', 10000, 4500, false, true, null],
    ]);
});

it('seeds nothing outside the local environment', function () {
    $this->seed(DevSeeder::class);

    expect(Category::query()->count())->toBe(0)
        ->and(Product::query()->count())->toBe(0);
});
