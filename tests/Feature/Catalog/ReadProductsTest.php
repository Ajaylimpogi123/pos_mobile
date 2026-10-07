<?php

use App\Models\Category;
use App\Models\Product;

beforeEach(function () {
    seedRoles();
    $this->token = tokenFor(userWithRole('cashier'));
    $this->breakfast = Category::factory()->create(['name' => 'Breakfast', 'sort_order' => 10]);
});

it('lists products in the exact Product shape without cost_cents', function () {
    $product = Product::factory()->forCategory($this->breakfast)->create([
        'sku' => 'BRK-001',
        'name' => 'Egg with Rice',
        'description' => 'Two fried eggs, garlic rice',
        'price_cents' => 5000,
        'cost_cents' => 2200,
    ]);

    $response = $this->withToken($this->token)->getJson('/api/v1/products')->assertOk();

    expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
        ->and(array_keys($response->json('data.0')))->toBe(productKeys(withCost: false))
        ->and($response->json('data.0'))->not->toHaveKey('cost_cents');

    $response->assertJsonPath('meta.per_page', 50)
        ->assertJsonPath('meta.next_cursor', null)
        ->assertJsonPath('data.0', [
            'id' => $product->id,
            'category' => ['id' => $this->breakfast->id, 'name' => 'Breakfast'],
            'sku' => 'BRK-001',
            'name' => 'Egg with Rice',
            'description' => 'Two fried eggs, garlic rice',
            'price_cents' => 5000,
            'is_vatable' => true,
            'is_available' => true,
            'track_stock' => false,
            'stock_mode' => 'none',
            'sort_order' => 0,
            'image_url' => null,
            'image_path' => null,
            'created_at' => $product->created_at->toIso8601ZuluString(),
            'updated_at' => $product->updated_at->toIso8601ZuluString(),
        ]);

    expect($response->getContent())->not->toContain('cost_cents');
});

it('hides cost_cents from managers on the read endpoint too', function () {
    Product::factory()->forCategory($this->breakfast)->create();

    $response = $this->withToken(tokenFor(userWithRole('manager')))->getJson('/api/v1/products')->assertOk();

    expect($response->json('data.0'))->not->toHaveKey('cost_cents');
});

it('returns an absolute image_url when the product has an image', function () {
    Product::factory()->forCategory($this->breakfast)->create(['image_path' => 'products/9/x.png']);

    $this->withToken($this->token)->getJson('/api/v1/products')
        ->assertOk()
        ->assertJsonPath('data.0.image_path', 'products/9/x.png')
        ->assertJsonPath('data.0.image_url', rtrim(config('app.url'), '/').'/storage/products/9/x.png');
});

it('includes unavailable products but excludes deleted ones and those in inactive or deleted categories', function () {
    $available = Product::factory()->forCategory($this->breakfast)->create(['name' => 'A available']);
    $unavailable = Product::factory()->forCategory($this->breakfast)->unavailable()->create(['name' => 'B unavailable']);
    Product::factory()->forCategory($this->breakfast)->create(['name' => 'C deleted'])->delete();

    $inactive = Category::factory()->inactive()->create();
    Product::factory()->forCategory($inactive)->create(['name' => 'D in inactive']);

    $deletedCategory = Category::factory()->create();
    $orphan = Product::factory()->forCategory($deletedCategory)->create(['name' => 'E in deleted category']);
    $orphan->delete();
    $deletedCategory->delete();

    $response = $this->withToken($this->token)->getJson('/api/v1/products')->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())->toBe([$available->id, $unavailable->id])
        ->and($response->json('data.1.is_available'))->toBeFalse();
});

it('orders by sort_order, then name, then id, and paginates with a cursor', function () {
    $c = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Coffee', 'sort_order' => 5]);
    $b2 = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Bread', 'sort_order' => 0]);
    $a = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Apple', 'sort_order' => 0]);
    $b1 = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Bread', 'sort_order' => 0]);
    // $b2 was created before $b1, so it has the lower id.

    $page1 = $this->withToken($this->token)->getJson('/api/v1/products?per_page=2')->assertOk();
    expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$a->id, $b2->id]);

    $page2 = $this->withToken($this->token)
        ->getJson('/api/v1/products?per_page=2&cursor='.$page1->json('meta.next_cursor'))
        ->assertOk();
    expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$b1->id, $c->id])
        ->and($page2->json('meta.next_cursor'))->toBeNull()
        ->and($page2->json('meta.prev_cursor'))->toBeString();
});

it('carries filters into the next-page link', function () {
    Product::factory()->forCategory($this->breakfast)->count(3)->create();

    $response = $this->withToken($this->token)
        ->getJson('/api/v1/products?per_page=1&category_id='.$this->breakfast->id)
        ->assertOk();

    expect($response->json('links.next'))->toContain('category_id='.$this->breakfast->id);
});

it('filters by category_id', function () {
    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $tea = Product::factory()->forCategory($drinks)->create();
    Product::factory()->forCategory($this->breakfast)->create();

    $response = $this->withToken($this->token)->getJson('/api/v1/products?category_id='.$drinks->id)->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())->toBe([$tea->id]);
});

it('returns an empty list for an unknown, inactive or deleted category_id', function () {
    $inactive = Category::factory()->inactive()->create();
    Product::factory()->forCategory($inactive)->create();
    $deleted = Category::factory()->create();
    $deleted->delete();
    Product::factory()->forCategory($this->breakfast)->create();

    foreach ([999999, $inactive->id, $deleted->id] as $id) {
        $this->withToken($this->token)
            ->getJson('/api/v1/products?category_id='.$id)
            ->assertOk()
            ->assertJsonPath('data', []);
    }
});

it('searches name or sku case-insensitively and treats wildcards literally', function () {
    $egg = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Egg with Rice', 'sku' => 'BRK-001']);
    $dog = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Hot Dog', 'sku' => 'BRK_002']);
    $pct = Product::factory()->forCategory($this->breakfast)->create(['name' => '100% Juice', 'sku' => null]);

    $ids = fn (string $search) => collect(
        $this->withToken($this->token)->getJson('/api/v1/products?search='.urlencode($search))->assertOk()->json('data')
    )->pluck('id')->all();

    expect($ids('EGG'))->toBe([$egg->id])
        ->and($ids('brk-001'))->toBe([$egg->id])
        ->and($ids('brk'))->toBe([$egg->id, $dog->id])
        ->and($ids('%'))->toBe([$pct->id])
        ->and($ids('_'))->toBe([$dog->id])
        ->and($ids('nothing'))->toBe([]);
});

it('returns 401 without a token', function () {
    $this->getJson('/api/v1/products')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('validates query params', function (string $query, string $field, string $message) {
    $this->withToken($this->token)
        ->getJson('/api/v1/products?'.$query)
        ->assertUnprocessable()
        ->assertJsonValidationErrors([$field => $message]);
})->with([
    ['per_page=0', 'per_page', 'The per page field must be at least 1.'],
    ['per_page=101', 'per_page', 'The per page field must not be greater than 100.'],
    ['category_id=abc', 'category_id', 'The category id field must be an integer.'],
    ['search='.str_repeat('a', 101), 'search', 'The search field must not be greater than 100 characters.'],
]);
