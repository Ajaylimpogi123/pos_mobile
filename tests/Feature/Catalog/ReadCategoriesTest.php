<?php

use App\Models\Category;
use App\Models\Product;

beforeEach(function () {
    seedRoles();
    $this->cashier = userWithRole('cashier');
    $this->token = tokenFor($this->cashier);
});

it('lists active categories for a cashier in the exact Category shape and pagination envelope', function () {
    $category = Category::factory()->create([
        'name' => 'Breakfast',
        'description' => 'Served until 11 AM',
        'sort_order' => 10,
        'image_path' => 'categories/1/abc.webp',
    ]);

    $response = $this->withToken($this->token)->getJson('/api/v1/categories')->assertOk();

    expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
        ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
        ->and(array_keys($response->json('data.0')))->toBe(categoryKeys());

    $response->assertJsonPath('meta.per_page', 100)
        ->assertJsonPath('meta.next_cursor', null)
        ->assertJsonPath('meta.path', url('/api/v1/categories'))
        ->assertJsonPath('data.0', [
            'id' => $category->id,
            'name' => 'Breakfast',
            'description' => 'Served until 11 AM',
            'sort_order' => 10,
            'is_active' => true,
            'products_count' => 0,
            'image_url' => rtrim(config('app.url'), '/').'/storage/categories/1/abc.webp',
            'image_path' => 'categories/1/abc.webp',
            'created_at' => $category->created_at->toIso8601ZuluString(),
            'updated_at' => $category->updated_at->toIso8601ZuluString(),
        ]);

    expect($response->json('data.0.image_url'))->toStartWith('http');
});

it('returns null image fields and nullable description when absent', function () {
    Category::factory()->create();

    $this->withToken($this->token)->getJson('/api/v1/categories')
        ->assertOk()
        ->assertJsonPath('data.0.image_url', null)
        ->assertJsonPath('data.0.image_path', null)
        ->assertJsonPath('data.0.description', null);
});

it('hides inactive and soft-deleted categories', function () {
    $active = Category::factory()->create(['name' => 'Active']);
    Category::factory()->inactive()->create(['name' => 'Inactive']);
    Category::factory()->create(['name' => 'Deleted'])->delete();

    $response = $this->withToken($this->token)->getJson('/api/v1/categories')->assertOk();

    expect(collect($response->json('data'))->pluck('id')->all())->toBe([$active->id]);
});

it('counts only available, non-deleted products', function () {
    $category = Category::factory()->create();
    Product::factory()->forCategory($category)->count(2)->create();
    Product::factory()->forCategory($category)->unavailable()->create();
    Product::factory()->forCategory($category)->create()->delete();

    $this->withToken($this->token)->getJson('/api/v1/categories')
        ->assertOk()
        ->assertJsonPath('data.0.products_count', 2);
});

it('orders by sort_order, then name, then id, and paginates with a cursor', function () {
    $drinks = Category::factory()->create(['name' => 'Drinks', 'sort_order' => 30]);
    $meals = Category::factory()->create(['name' => 'Meals', 'sort_order' => 20]);
    $zeta = Category::factory()->create(['name' => 'Zeta', 'sort_order' => 10]);
    $alpha = Category::factory()->create(['name' => 'Alpha', 'sort_order' => 10]);

    $page1 = $this->withToken($this->token)->getJson('/api/v1/categories?per_page=3')->assertOk();
    expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$alpha->id, $zeta->id, $meals->id])
        ->and($page1->json('meta.per_page'))->toBe(3);

    $cursor = $page1->json('meta.next_cursor');
    expect($cursor)->toBeString();

    $page2 = $this->withToken($this->token)->getJson('/api/v1/categories?per_page=3&cursor='.$cursor)->assertOk();
    expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$drinks->id])
        ->and($page2->json('meta.next_cursor'))->toBeNull();
});

it('is available to every role', function (string $role) {
    Category::factory()->create();

    $this->withToken(tokenFor(userWithRole($role)))
        ->getJson('/api/v1/categories')
        ->assertOk()
        ->assertJsonCount(1, 'data');
})->with(['owner', 'manager', 'cashier']);

it('returns 401 without a token', function () {
    $this->getJson('/api/v1/categories')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 for a deactivated user', function () {
    $user = userWithRole('cashier');
    $token = tokenFor($user);
    $user->forceFill(['is_active' => false])->save();

    $this->withToken($token)->getJson('/api/v1/categories')->assertUnauthorized();
});

it('validates per_page', function (string $query, string $message) {
    $this->withToken($this->token)
        ->getJson('/api/v1/categories?'.$query)
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['per_page' => $message]);
})->with([
    ['per_page=0', 'The per page field must be at least 1.'],
    ['per_page=101', 'The per page field must not be greater than 100.'],
    ['per_page=abc', 'The per page field must be an integer.'],
]);

it('accepts per_page of 100', function () {
    $this->withToken($this->token)->getJson('/api/v1/categories?per_page=100')
        ->assertOk()
        ->assertJsonPath('meta.per_page', 100);
});
