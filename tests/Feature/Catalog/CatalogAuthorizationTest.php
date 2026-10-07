<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\UploadedFile;

beforeEach(function () {
    seedRoles();
    $this->disk = fakeCatalogImageDisk();
    $this->category = Category::factory()->create(['name' => 'Breakfast']);
    $this->product = Product::factory()->forCategory($this->category)->create(['sku' => 'BRK-001']);
});

/**
 * Every admin catalogue endpoint: [method, uri template, valid body].
 * `{c}` and `{p}` are replaced with the category and product ids.
 */
dataset('admin catalogue endpoints', fn () => [
    'categories.index' => ['GET', '/api/v1/admin/categories', []],
    'categories.store' => ['POST', '/api/v1/admin/categories', ['name' => 'Snacks']],
    'categories.show' => ['GET', '/api/v1/admin/categories/{c}', []],
    'categories.update' => ['PATCH', '/api/v1/admin/categories/{c}', ['name' => 'Morning']],
    'categories.destroy' => ['DELETE', '/api/v1/admin/categories/{c}', []],
    'categories.image.store' => ['POST', '/api/v1/admin/categories/{c}/image', ['image' => 'IMAGE']],
    'categories.image.destroy' => ['DELETE', '/api/v1/admin/categories/{c}/image', []],
    'products.index' => ['GET', '/api/v1/admin/products', []],
    'products.store' => ['POST', '/api/v1/admin/products', ['category_id' => '{c}', 'name' => 'Toast', 'price_cents' => 3000]],
    'products.show' => ['GET', '/api/v1/admin/products/{p}', []],
    'products.update' => ['PATCH', '/api/v1/admin/products/{p}', ['price_cents' => 5500]],
    'products.destroy' => ['DELETE', '/api/v1/admin/products/{p}', []],
    'products.image.store' => ['POST', '/api/v1/admin/products/{p}/image', ['image' => 'IMAGE']],
    'products.image.destroy' => ['DELETE', '/api/v1/admin/products/{p}/image', []],
]);

function callAdminEndpoint(string $method, string $uri, array $body, ?string $token)
{
    $test = test();
    $uri = str_replace(['{c}', '{p}'], [$test->category->id, $test->product->id], $uri);
    $body = array_map(function ($value) use ($test) {
        return match ($value) {
            '{c}' => $test->category->id,
            'IMAGE' => fakeWebp('photo.webp', 200, 200),
            default => $value,
        };
    }, $body);

    $request = $token === null ? $test : $test->withToken($token);

    if (collect($body)->contains(fn ($value) => $value instanceof UploadedFile)) {
        return $request->post($uri, $body, ['Accept' => 'application/json']);
    }

    return $request->json($method, $uri, $body);
}

it('returns 401 without a token', function (string $method, string $uri, array $body) {
    callAdminEndpoint($method, $uri, $body, null)
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
})->with('admin catalogue endpoints');

it('returns 403 for a cashier and changes nothing', function (string $method, string $uri, array $body) {
    $token = tokenFor(userWithRole('cashier'));
    $before = [Category::query()->count(), Product::query()->count(), $this->product->fresh()->toArray(), $this->category->fresh()->toArray()];

    callAdminEndpoint($method, $uri, $body, $token)
        ->assertForbidden()
        ->assertExactJson(['message' => 'This action is unauthorized.']);

    expect([Category::query()->count(), Product::query()->count(), $this->product->fresh()->toArray(), $this->category->fresh()->toArray()])
        ->toBe($before)
        ->and(AuditLog::query()->count())->toBe(0)
        ->and($this->disk->allFiles())->toBe([]);
})->with('admin catalogue endpoints');

it('returns 403 (not 422) for a cashier sending an invalid body', function (string $method, string $uri) {
    callAdminEndpoint($method, $uri, ['name' => str_repeat('x', 500), 'price_cents' => 'abc'], tokenFor(userWithRole('cashier')))
        ->assertForbidden();
})->with([
    ['POST', '/api/v1/admin/categories'],
    ['PATCH', '/api/v1/admin/categories/{c}'],
    ['POST', '/api/v1/admin/products'],
    ['PATCH', '/api/v1/admin/products/{p}'],
    ['POST', '/api/v1/admin/categories/{c}/image'],
    ['POST', '/api/v1/admin/products/{p}/image'],
]);

it('allows an owner and a manager', function (string $role) {
    $token = tokenFor(userWithRole($role));

    $this->withToken($token)->getJson('/api/v1/admin/categories')->assertOk();
    $this->withToken($token)->getJson('/api/v1/admin/products')->assertOk();
    $this->withToken($token)->postJson('/api/v1/admin/categories', ['name' => 'By '.$role])->assertCreated();
})->with(['owner', 'manager']);

it('returns 401 (not 404) for a deactivated user requesting an unknown id', function () {
    $manager = userWithRole('manager');
    $token = tokenFor($manager);
    $manager->forceFill(['is_active' => false])->save();

    $this->withToken($token)->getJson('/api/v1/admin/categories/999999')->assertUnauthorized();
});
