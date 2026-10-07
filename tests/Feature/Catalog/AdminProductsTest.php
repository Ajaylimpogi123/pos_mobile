<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;

beforeEach(function () {
    seedRoles();
    $this->manager = userWithRole('manager');
    $this->token = tokenFor($this->manager);
    $this->breakfast = Category::factory()->create(['name' => 'Breakfast']);
});

function validProduct(array $overrides = []): array
{
    return [
        'category_id' => test()->breakfast->id,
        'name' => 'Egg with Rice',
        'price_cents' => 5000,
        ...$overrides,
    ];
}

describe('index', function () {
    it('lists products with cost_cents in the exact shape and a default page size of 25', function () {
        $product = Product::factory()->forCategory($this->breakfast)->create([
            'sku' => 'BRK-001', 'price_cents' => 5000, 'cost_cents' => 2200,
        ]);

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/products')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('data.0')))->toBe(productKeys(withCost: true));

        $response->assertJsonPath('meta.per_page', 25)
            ->assertJsonPath('data.0.id', $product->id)
            ->assertJsonPath('data.0.category', ['id' => $this->breakfast->id, 'name' => 'Breakfast'])
            ->assertJsonPath('data.0.price_cents', 5000)
            ->assertJsonPath('data.0.cost_cents', 2200);
    });

    it('includes products in inactive categories and unavailable products, but not soft-deleted ones', function () {
        $inactive = Category::factory()->inactive()->create();
        $a = Product::factory()->forCategory($inactive)->create(['name' => 'A']);
        $b = Product::factory()->forCategory($this->breakfast)->unavailable()->create(['name' => 'B']);
        Product::factory()->forCategory($this->breakfast)->create(['name' => 'C'])->delete();

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/products')->assertOk();

        expect(collect($response->json('data'))->pluck('id')->all())->toBe([$a->id, $b->id]);
    });

    it('orders by sort_order, then name, then id, and paginates', function () {
        $c = Product::factory()->forCategory($this->breakfast)->create(['name' => 'A', 'sort_order' => 2]);
        $b = Product::factory()->forCategory($this->breakfast)->create(['name' => 'B', 'sort_order' => 1]);
        $a = Product::factory()->forCategory($this->breakfast)->create(['name' => 'A', 'sort_order' => 1]);

        $page1 = $this->withToken($this->token)->getJson('/api/v1/admin/products?per_page=2')->assertOk();
        expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$a->id, $b->id]);

        $page2 = $this->withToken($this->token)
            ->getJson('/api/v1/admin/products?per_page=2&cursor='.$page1->json('meta.next_cursor'))
            ->assertOk();
        expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$c->id])
            ->and($page2->json('meta.next_cursor'))->toBeNull();
    });

    it('filters by category_id and is_available, and searches name or sku', function () {
        $drinks = Category::factory()->create(['name' => 'Drinks']);
        $egg = Product::factory()->forCategory($this->breakfast)->create(['name' => 'Egg with Rice', 'sku' => 'BRK-001']);
        $dog = Product::factory()->forCategory($this->breakfast)->unavailable()->create(['name' => 'Hot Dog', 'sku' => 'BRK-002']);
        $tea = Product::factory()->forCategory($drinks)->create(['name' => 'Iced Tea', 'sku' => 'DRK-001']);

        $ids = fn (string $query) => collect(
            $this->withToken($this->token)->getJson('/api/v1/admin/products?'.$query)->assertOk()->json('data')
        )->pluck('id')->all();

        expect($ids('category_id='.$drinks->id))->toBe([$tea->id])
            ->and($ids('category_id=999999'))->toBe([])
            ->and($ids('is_available=0'))->toBe([$dog->id])
            ->and($ids('is_available=false'))->toBe([$dog->id])
            ->and($ids('is_available=true'))->toBe([$egg->id, $tea->id])
            ->and($ids('search=brk'))->toBe([$egg->id, $dog->id])
            ->and($ids('search=TEA'))->toBe([$tea->id])
            ->and($ids('search=%25'))->toBe([])
            ->and($ids('category_id='.$this->breakfast->id.'&is_available=1&search=egg'))->toBe([$egg->id]);
    });

    it('validates query params', function (string $query, string $field) {
        $this->withToken($this->token)
            ->getJson('/api/v1/admin/products?'.$query)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        ['per_page=0', 'per_page'],
        ['per_page=101', 'per_page'],
        ['search='.str_repeat('a', 101), 'search'],
        ['category_id=abc', 'category_id'],
        ['is_available=maybe', 'is_available'],
    ]);
});

describe('store', function () {
    it('creates a product and returns 201 with the exact Product including cost_cents', function () {
        $response = $this->withToken($this->token)->postJson('/api/v1/admin/products', [
            'category_id' => $this->breakfast->id,
            'sku' => 'BRK-001',
            'name' => 'Egg with Rice',
            'description' => 'Two fried eggs, garlic rice',
            'price_cents' => 5000,
            'cost_cents' => 2200,
            'is_vatable' => false,
            'is_available' => false,
            'track_stock' => true,
            'sort_order' => 3,
        ]);

        $response->assertCreated();
        $product = Product::query()->sole();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(productKeys(withCost: true));

        $response->assertExactJson(['data' => [
            'id' => $product->id,
            'category' => ['id' => $this->breakfast->id, 'name' => 'Breakfast'],
            'sku' => 'BRK-001',
            'name' => 'Egg with Rice',
            'description' => 'Two fried eggs, garlic rice',
            'price_cents' => 5000,
            'cost_cents' => 2200,
            'is_vatable' => false,
            'is_available' => false,
            'track_stock' => true,
            'stock_mode' => 'own',
            'stock_qty' => 0,
            'sort_order' => 3,
            'image_url' => null,
            'image_path' => null,
            'created_at' => $product->created_at->toIso8601ZuluString(),
            'updated_at' => $product->updated_at->toIso8601ZuluString(),
        ]]);

        expect($product->created_by)->toBe($this->manager->id)
            ->and($product->updated_by)->toBe($this->manager->id);
    });

    it('applies the contract defaults', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct())
            ->assertCreated()
            ->assertJsonPath('data.sku', null)
            ->assertJsonPath('data.description', null)
            ->assertJsonPath('data.cost_cents', 0)
            ->assertJsonPath('data.is_vatable', true)
            ->assertJsonPath('data.is_available', true)
            ->assertJsonPath('data.track_stock', false)
            ->assertJsonPath('data.sort_order', 0);
    });

    it('accepts an inactive category and the maximum values', function () {
        $inactive = Category::factory()->inactive()->create();

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct([
                'category_id' => $inactive->id,
                'name' => str_repeat('n', 120),
                'sku' => str_repeat('S', 50),
                'description' => str_repeat('d', 500),
                'price_cents' => 100000000,
                'cost_cents' => 100000000,
                'sort_order' => 65535,
            ]))
            ->assertCreated()
            ->assertJsonPath('data.category.id', $inactive->id)
            ->assertJsonPath('data.price_cents', 100000000);
    });

    it('writes a product.created audit entry', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct(['sku' => 'BRK-001', 'cost_cents' => 2200]))
            ->assertCreated();

        $audit = lastAudit('product.created');
        $product = Product::query()->sole();

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_type)->toBe($product->getMorphClass())
            ->and($audit->subject_id)->toBe($product->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'category_id' => ['from' => null, 'to' => $this->breakfast->id],
                'sku' => ['from' => null, 'to' => 'BRK-001'],
                'name' => ['from' => null, 'to' => 'Egg with Rice'],
                'description' => ['from' => null, 'to' => null],
                'price_cents' => ['from' => null, 'to' => 5000],
                'cost_cents' => ['from' => null, 'to' => 2200],
                'is_vatable' => ['from' => null, 'to' => true],
                'is_available' => ['from' => null, 'to' => true],
                'stock_mode' => ['from' => null, 'to' => 'none'],
                'track_stock' => ['from' => null, 'to' => false],
                'sort_order' => ['from' => null, 'to' => 0],
            ]));
    });

    it('requires category_id, name and price_cents', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'category_id' => 'The category id field is required.',
                'name' => 'The name field is required.',
                'price_cents' => 'The price cents field is required.',
            ]);
    });

    it('rejects money that is not a JSON integer', function (string $field, mixed $value) {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct([$field => $value]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => 'The '.str_replace('_', ' ', $field).' field must be an integer.']);

        expect(Product::query()->count())->toBe(0);
    })->with([
        'price "5000"' => ['price_cents', '5000'],
        'price "50.00"' => ['price_cents', '50.00'],
        'price 50.5' => ['price_cents', 50.5],
        'price true' => ['price_cents', true],
        'cost "5000"' => ['cost_cents', '5000'],
        'cost "50.00"' => ['cost_cents', '50.00'],
        'cost 50.5' => ['cost_cents', 50.5],
    ]);

    it('rejects a JSON number with a zero fraction (5000.0)', function () {
        // json_encode() would turn 5000.0 into 5000, so send the raw body.
        $body = sprintf('{"category_id":%d,"name":"Egg","price_cents":5000.0}', $this->breakfast->id);

        $this->call('POST', '/api/v1/admin/products', server: [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_AUTHORIZATION' => 'Bearer '.$this->token,
        ], content: $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['price_cents' => 'The price cents field must be an integer.']);
    });

    it('rejects invalid fields', function (array $body, string $field, string $message) {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct($body))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);
    })->with([
        'price negative' => [['price_cents' => -1], 'price_cents', 'The price cents field must be at least 0.'],
        'price too big' => [['price_cents' => 100000001], 'price_cents', 'The price cents field must not be greater than 100000000.'],
        'cost negative' => [['cost_cents' => -1], 'cost_cents', 'The cost cents field must be at least 0.'],
        'cost too big' => [['cost_cents' => 100000001], 'cost_cents', 'The cost cents field must not be greater than 100000000.'],
        'cost null' => [['cost_cents' => null], 'cost_cents', 'The cost cents field is required.'],
        'name too long' => [['name' => str_repeat('a', 121)], 'name', 'The name field must not be greater than 120 characters.'],
        'sku too long' => [['sku' => str_repeat('a', 51)], 'sku', 'The sku field must not be greater than 50 characters.'],
        'sku with spaces' => [['sku' => 'BRK 001'], 'sku', 'The sku field must only contain letters, numbers, dashes, and underscores.'],
        'description too long' => [['description' => str_repeat('a', 501)], 'description', 'The description field must not be greater than 500 characters.'],
        'is_vatable not boolean' => [['is_vatable' => 'yes'], 'is_vatable', 'The is vatable field must be true or false.'],
        'is_available null' => [['is_available' => null], 'is_available', 'The is available field is required.'],
        'track_stock not boolean' => [['track_stock' => 2], 'track_stock', 'The track stock field must be true or false.'],
        'sort_order too big' => [['sort_order' => 65536], 'sort_order', 'The sort order field must not be greater than 65535.'],
        'sort_order negative' => [['sort_order' => -1], 'sort_order', 'The sort order field must be at least 0.'],
        'category_id not integer' => [['category_id' => 'abc'], 'category_id', 'The category id field must be an integer.'],
        'category_id unknown' => [['category_id' => 999999], 'category_id', 'The selected category id is invalid.'],
    ]);

    it('rejects a soft-deleted category', function () {
        $deleted = Category::factory()->create();
        $deleted->delete();

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct(['category_id' => $deleted->id]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category_id' => 'The selected category id is invalid.']);
    });

    it('rejects a duplicate sku, case-insensitively', function (string $sku) {
        Product::factory()->forCategory($this->breakfast)->create(['sku' => 'BRK-001']);

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct(['sku' => $sku]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['sku' => 'The sku has already been taken.']);
    })->with(['BRK-001', 'brk-001']);

    it('allows reusing the sku of a soft-deleted product, and several products without a sku', function () {
        Product::factory()->forCategory($this->breakfast)->create(['sku' => 'BRK-001'])->delete();
        Product::factory()->forCategory($this->breakfast)->create(['sku' => null]);

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct(['sku' => 'BRK-001']))
            ->assertCreated();

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/products', validProduct(['name' => 'No SKU', 'sku' => null]))
            ->assertCreated()
            ->assertJsonPath('data.sku', null);
    });
});

describe('show', function () {
    it('returns the exact Product with cost_cents', function () {
        $product = Product::factory()->forCategory($this->breakfast)->create(['cost_cents' => 1234]);

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/products/'.$product->id)->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(productKeys(withCost: true));

        $response->assertJsonPath('data.id', $product->id)
            ->assertJsonPath('data.cost_cents', 1234);
    });

    it('returns 404 for an unknown or soft-deleted id', function () {
        $deleted = Product::factory()->forCategory($this->breakfast)->create();
        $deleted->delete();

        foreach ([999999, $deleted->id] as $id) {
            $this->withToken($this->token)
                ->getJson('/api/v1/admin/products/'.$id)
                ->assertNotFound()
                ->assertExactJson(['message' => 'Resource not found.']);
        }
    });
});

describe('update', function () {
    beforeEach(function () {
        $this->product = Product::factory()->forCategory($this->breakfast)->create([
            'sku' => 'BRK-001',
            'name' => 'Egg with Rice',
            'description' => 'Two fried eggs',
            'price_cents' => 5000,
            'cost_cents' => 2200,
            'is_vatable' => true,
            'is_available' => true,
            'track_stock' => false,
            'sort_order' => 0,
        ]);
        $this->url = '/api/v1/admin/products/'.$this->product->id;
    });

    it('changes only the fields sent and returns the Product with cost_cents', function () {
        $response = $this->withToken($this->token)
            ->patchJson($this->url, ['price_cents' => 5500])
            ->assertOk();

        expect(array_keys($response->json('data')))->toBe(productKeys(withCost: true));

        $response->assertJsonPath('data.price_cents', 5500)
            ->assertJsonPath('data.cost_cents', 2200)
            ->assertJsonPath('data.name', 'Egg with Rice')
            ->assertJsonPath('data.sku', 'BRK-001')
            ->assertJsonPath('data.description', 'Two fried eggs')
            ->assertJsonPath('data.is_vatable', true);

        $fresh = $this->product->fresh();
        expect($fresh->price_cents)->toBe(5500)
            ->and($fresh->cost_cents)->toBe(2200)
            ->and($fresh->name)->toBe('Egg with Rice')
            ->and($fresh->updated_by)->toBe($this->manager->id);
    });

    it('records a price change as product.updated with from/to', function () {
        $this->withToken($this->token)->patchJson($this->url, ['price_cents' => 5500, 'name' => 'Egg with Rice'])->assertOk();

        $audit = lastAudit('product.updated');

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($this->product->id)
            ->and(ksortDeep($audit->changes))->toBe(['price_cents' => ['from' => 5000, 'to' => 5500]]);
    });

    it('records every changed field', function () {
        $drinks = Category::factory()->create(['name' => 'Drinks']);

        $this->withToken($this->token)->patchJson($this->url, [
            'category_id' => $drinks->id,
            'sku' => null,
            'is_available' => false,
            'track_stock' => true,
        ])->assertOk()->assertJsonPath('data.category', ['id' => $drinks->id, 'name' => 'Drinks']);

        expect(ksortDeep(lastAudit('product.updated')->changes))->toBe(ksortDeep([
            'category_id' => ['from' => $this->breakfast->id, 'to' => $drinks->id],
            'sku' => ['from' => 'BRK-001', 'to' => null],
            'is_available' => ['from' => true, 'to' => false],
            'stock_mode' => ['from' => 'none', 'to' => 'own'],
            'track_stock' => ['from' => false, 'to' => true],
        ]));
    });

    it('writes no audit entry when nothing changed', function () {
        $this->withToken($this->token)->patchJson($this->url, ['price_cents' => 5000, 'sku' => 'BRK-001'])->assertOk();

        expect(AuditLog::query()->where('action', 'product.updated')->count())->toBe(0);
    });

    it('clears nullable fields with null', function () {
        $this->withToken($this->token)
            ->patchJson($this->url, ['sku' => null, 'description' => null])
            ->assertOk()
            ->assertJsonPath('data.sku', null)
            ->assertJsonPath('data.description', null);

        $fresh = $this->product->fresh();
        expect($fresh->sku)->toBeNull()->and($fresh->description)->toBeNull();
    });

    it('rejects null for non-nullable fields', function (string $field) {
        $this->withToken($this->token)
            ->patchJson($this->url, [$field => null])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);

        expect($this->product->fresh()->price_cents)->toBe(5000);
    })->with(['category_id', 'name', 'price_cents', 'cost_cents', 'is_vatable', 'is_available', 'track_stock', 'sort_order']);

    it('rejects money that is not a JSON integer', function (mixed $value) {
        $this->withToken($this->token)
            ->patchJson($this->url, ['price_cents' => $value])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['price_cents' => 'The price cents field must be an integer.']);
    })->with(['5000', '50.00', 50.5]);

    it('rejects a soft-deleted category', function () {
        $deleted = Category::factory()->create();
        $deleted->delete();

        $this->withToken($this->token)
            ->patchJson($this->url, ['category_id' => $deleted->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category_id' => 'The selected category id is invalid.']);
    });

    it('keeps its own sku (any case) but rejects another product\'s sku', function () {
        Product::factory()->forCategory($this->breakfast)->create(['sku' => 'BRK-002']);

        $this->withToken($this->token)->patchJson($this->url, ['sku' => 'brk-001'])
            ->assertOk()
            ->assertJsonPath('data.sku', 'brk-001');

        $this->withToken($this->token)->patchJson($this->url, ['sku' => 'BRK-002'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['sku' => 'The sku has already been taken.']);
    });

    it('returns 404 for a soft-deleted product', function () {
        $this->product->delete();

        $this->withToken($this->token)
            ->patchJson($this->url, ['price_cents' => 1])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    });
});

describe('destroy', function () {
    it('soft-deletes a product, returns 204, audits, then 404 everywhere', function () {
        $product = Product::factory()->forCategory($this->breakfast)->create(['sku' => 'BRK-009']);

        $this->withToken($this->token)
            ->deleteJson('/api/v1/admin/products/'.$product->id)
            ->assertNoContent();

        expect(Product::withTrashed()->find($product->id)->trashed())->toBeTrue();

        $this->withToken($this->token)->getJson('/api/v1/admin/products/'.$product->id)->assertNotFound();
        $this->withToken($this->token)->deleteJson('/api/v1/admin/products/'.$product->id)->assertNotFound();

        $audit = lastAudit('product.deleted');
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($product->id);

        // The category can now be deleted.
        $this->withToken($this->token)
            ->deleteJson('/api/v1/admin/categories/'.$this->breakfast->id)
            ->assertNoContent();
    });
});
