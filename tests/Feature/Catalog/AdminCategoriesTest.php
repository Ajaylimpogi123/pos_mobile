<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;

beforeEach(function () {
    seedRoles();
    $this->manager = userWithRole('manager');
    $this->token = tokenFor($this->manager);
});

describe('index', function () {
    it('lists categories in the exact shape with the default page size of 25', function () {
        $category = Category::factory()->create(['name' => 'Breakfast', 'sort_order' => 10]);

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/categories')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
            ->and(array_keys($response->json('data.0')))->toBe(categoryKeys());

        $response->assertJsonPath('meta.per_page', 25)
            ->assertJsonPath('meta.path', url('/api/v1/admin/categories'))
            ->assertJsonPath('data.0.id', $category->id)
            ->assertJsonPath('data.0.name', 'Breakfast');
    });

    it('includes inactive categories and excludes soft-deleted ones', function () {
        $active = Category::factory()->create(['name' => 'A']);
        $inactive = Category::factory()->inactive()->create(['name' => 'B']);
        Category::factory()->create(['name' => 'C'])->delete();

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/categories')->assertOk();

        expect(collect($response->json('data'))->pluck('id')->all())->toBe([$active->id, $inactive->id]);
    });

    it('counts all non-deleted products, including unavailable ones', function () {
        $category = Category::factory()->create();
        Product::factory()->forCategory($category)->create();
        Product::factory()->forCategory($category)->unavailable()->create();
        Product::factory()->forCategory($category)->create()->delete();

        $this->withToken($this->token)->getJson('/api/v1/admin/categories')
            ->assertOk()
            ->assertJsonPath('data.0.products_count', 2);
    });

    it('orders by sort_order, then name, then id, and paginates', function () {
        $b = Category::factory()->create(['name' => 'B', 'sort_order' => 1]);
        $a = Category::factory()->create(['name' => 'A', 'sort_order' => 1]);
        $z = Category::factory()->create(['name' => 'Z', 'sort_order' => 0]);

        $page1 = $this->withToken($this->token)->getJson('/api/v1/admin/categories?per_page=2')->assertOk();
        expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$z->id, $a->id]);

        $page2 = $this->withToken($this->token)
            ->getJson('/api/v1/admin/categories?per_page=2&cursor='.$page1->json('meta.next_cursor'))
            ->assertOk();
        expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$b->id])
            ->and($page2->json('meta.next_cursor'))->toBeNull();
    });

    it('searches name case-insensitively with literal wildcards', function () {
        $breakfast = Category::factory()->create(['name' => 'Breakfast']);
        $pct = Category::factory()->create(['name' => '50% Off']);
        Category::factory()->create(['name' => 'Drinks']);

        $ids = fn (string $search) => collect(
            $this->withToken($this->token)->getJson('/api/v1/admin/categories?search='.urlencode($search))->assertOk()->json('data')
        )->pluck('id')->all();

        expect($ids('BREAK'))->toBe([$breakfast->id])
            ->and($ids('%'))->toBe([$pct->id])
            ->and($ids('_'))->toBe([]);
    });

    it('filters by is_active', function (string $value, bool $expectActive) {
        $active = Category::factory()->create(['name' => 'Active']);
        $inactive = Category::factory()->inactive()->create(['name' => 'Inactive']);

        $response = $this->withToken($this->token)
            ->getJson('/api/v1/admin/categories?is_active='.$value)
            ->assertOk();

        expect(collect($response->json('data'))->pluck('id')->all())
            ->toBe([$expectActive ? $active->id : $inactive->id]);
    })->with([
        ['1', true],
        ['true', true],
        ['0', false],
        ['false', false],
    ]);

    it('validates query params', function (string $query, string $field) {
        $this->withToken($this->token)
            ->getJson('/api/v1/admin/categories?'.$query)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        ['per_page=0', 'per_page'],
        ['per_page=101', 'per_page'],
        ['search='.str_repeat('a', 101), 'search'],
        ['is_active=maybe', 'is_active'],
    ]);
});

describe('store', function () {
    it('creates a category and returns 201 with the exact Category', function () {
        $response = $this->withToken($this->token)->postJson('/api/v1/admin/categories', [
            'name' => 'Breakfast',
            'description' => 'Served until 11 AM',
            'sort_order' => 10,
            'is_active' => false,
        ]);

        $response->assertCreated();
        $category = Category::query()->sole();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(categoryKeys());

        $response->assertExactJson(['data' => [
            'id' => $category->id,
            'name' => 'Breakfast',
            'description' => 'Served until 11 AM',
            'sort_order' => 10,
            'is_active' => false,
            'products_count' => 0,
            'image_url' => null,
            'image_path' => null,
            'created_at' => $category->created_at->toIso8601ZuluString(),
            'updated_at' => $category->updated_at->toIso8601ZuluString(),
        ]]);

        expect($category->created_by)->toBe($this->manager->id)
            ->and($category->updated_by)->toBe($this->manager->id);
    });

    it('applies defaults and ignores unknown fields', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', ['name' => 'Meals', 'image_path' => 'hack.png', 'id' => 999])
            ->assertCreated()
            ->assertJsonPath('data.description', null)
            ->assertJsonPath('data.sort_order', 0)
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.image_path', null);

        expect(Category::query()->sole()->id)->not->toBe(999);
    });

    it('writes a category.created audit entry', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', ['name' => 'Meals', 'sort_order' => 20])
            ->assertCreated();

        $audit = lastAudit('category.created');
        $category = Category::query()->sole();

        expect($audit)->not->toBeNull()
            ->and($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_type)->toBe($category->getMorphClass())
            ->and($audit->subject_id)->toBe($category->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'name' => ['from' => null, 'to' => 'Meals'],
                'description' => ['from' => null, 'to' => null],
                'sort_order' => ['from' => null, 'to' => 20],
                'is_active' => ['from' => null, 'to' => true],
            ]));
    });

    it('requires a name', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'The name field is required.']);
    });

    it('rejects invalid fields', function (array $body, string $field, string $message) {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', ['name' => 'Valid', ...$body])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(Category::query()->count())->toBe(0);
    })->with([
        'name too long' => [['name' => str_repeat('a', 81)], 'name', 'The name field must not be greater than 80 characters.'],
        'name not string' => [['name' => 123], 'name', 'The name field must be a string.'],
        'description too long' => [['description' => str_repeat('a', 256)], 'description', 'The description field must not be greater than 255 characters.'],
        'sort_order negative' => [['sort_order' => -1], 'sort_order', 'The sort order field must be at least 0.'],
        'sort_order too big' => [['sort_order' => 65536], 'sort_order', 'The sort order field must not be greater than 65535.'],
        'sort_order not integer' => [['sort_order' => 1.5], 'sort_order', 'The sort order field must be an integer.'],
        'sort_order null' => [['sort_order' => null], 'sort_order', 'The sort order field is required.'],
        'is_active not boolean' => [['is_active' => 'yes'], 'is_active', 'The is active field must be true or false.'],
        'is_active null' => [['is_active' => null], 'is_active', 'The is active field is required.'],
    ]);

    it('accepts the boundary values', function () {
        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', [
                'name' => str_repeat('a', 80),
                'description' => str_repeat('d', 255),
                'sort_order' => 65535,
            ])
            ->assertCreated()
            ->assertJsonPath('data.sort_order', 65535);
    });

    it('rejects a duplicate name, case-insensitively', function (string $name) {
        Category::factory()->create(['name' => 'Breakfast']);

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', ['name' => $name])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'The name has already been taken.']);
    })->with(['Breakfast', 'BREAKFAST', 'breakfast']);

    it('allows reusing the name of a soft-deleted category', function () {
        Category::factory()->create(['name' => 'Breakfast'])->delete();

        $this->withToken($this->token)
            ->postJson('/api/v1/admin/categories', ['name' => 'Breakfast'])
            ->assertCreated();
    });
});

describe('show', function () {
    it('returns the exact Category with all non-deleted products counted', function () {
        $category = Category::factory()->inactive()->create(['name' => 'Hidden']);
        Product::factory()->forCategory($category)->unavailable()->create();

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/categories/'.$category->id)->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(categoryKeys());

        $response->assertJsonPath('data.id', $category->id)
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.products_count', 1);
    });

    it('returns 404 for an unknown or soft-deleted id', function () {
        $deleted = Category::factory()->create();
        $deleted->delete();

        foreach ([999999, $deleted->id, 'abc'] as $id) {
            $this->withToken($this->token)
                ->getJson('/api/v1/admin/categories/'.$id)
                ->assertNotFound()
                ->assertExactJson(['message' => 'Resource not found.']);
        }
    });
});

describe('update', function () {
    beforeEach(function () {
        $this->category = Category::factory()->create([
            'name' => 'Breakfast',
            'description' => 'Served until 11 AM',
            'sort_order' => 10,
            'is_active' => true,
        ]);
        $this->url = '/api/v1/admin/categories/'.$this->category->id;
    });

    it('changes only the fields sent and returns the Category', function () {
        $response = $this->withToken($this->token)
            ->patchJson($this->url, ['sort_order' => 15])
            ->assertOk();

        expect(array_keys($response->json('data')))->toBe(categoryKeys());

        $response->assertJsonPath('data.sort_order', 15)
            ->assertJsonPath('data.name', 'Breakfast')
            ->assertJsonPath('data.description', 'Served until 11 AM')
            ->assertJsonPath('data.is_active', true);

        $fresh = $this->category->fresh();
        expect($fresh->sort_order)->toBe(15)
            ->and($fresh->name)->toBe('Breakfast')
            ->and($fresh->description)->toBe('Served until 11 AM')
            ->and($fresh->updated_by)->toBe($this->manager->id);
    });

    it('clears description with null', function () {
        $this->withToken($this->token)
            ->patchJson($this->url, ['description' => null])
            ->assertOk()
            ->assertJsonPath('data.description', null);

        expect($this->category->fresh()->description)->toBeNull();
    });

    it('rejects null for non-nullable fields', function (string $field) {
        $this->withToken($this->token)
            ->patchJson($this->url, [$field => null])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);

        expect($this->category->fresh()->name)->toBe('Breakfast');
    })->with(['name', 'sort_order', 'is_active']);

    it('allows keeping its own name (in any case) but not another category\'s name', function () {
        Category::factory()->create(['name' => 'Drinks']);

        $this->withToken($this->token)->patchJson($this->url, ['name' => 'BREAKFAST'])
            ->assertOk()
            ->assertJsonPath('data.name', 'BREAKFAST');

        $this->withToken($this->token)->patchJson($this->url, ['name' => 'drinks'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'The name has already been taken.']);
    });

    it('allows taking the name of a soft-deleted category', function () {
        Category::factory()->create(['name' => 'Drinks'])->delete();

        $this->withToken($this->token)->patchJson($this->url, ['name' => 'Drinks'])->assertOk();
    });

    it('validates max values', function (array $body, string $field) {
        $this->withToken($this->token)
            ->patchJson($this->url, $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        [['name' => str_repeat('a', 81)], 'name'],
        [['description' => str_repeat('a', 256)], 'description'],
        [['sort_order' => 65536], 'sort_order'],
    ]);

    it('records only the changed fields in a category.updated audit entry', function () {
        $this->withToken($this->token)
            ->patchJson($this->url, ['name' => 'Morning', 'sort_order' => 10, 'is_active' => false])
            ->assertOk();

        $audit = lastAudit('category.updated');

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($this->category->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'name' => ['from' => 'Breakfast', 'to' => 'Morning'],
                'is_active' => ['from' => true, 'to' => false],
            ]));
    });

    it('writes no audit entry when nothing changed', function () {
        $this->withToken($this->token)
            ->patchJson($this->url, ['name' => 'Breakfast', 'sort_order' => 10])
            ->assertOk();

        expect(AuditLog::query()->where('action', 'category.updated')->count())->toBe(0);
    });

    it('returns 404 for a soft-deleted category', function () {
        $this->category->delete();

        $this->withToken($this->token)
            ->patchJson($this->url, ['name' => 'X'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    });
});

describe('destroy', function () {
    it('soft-deletes an empty category, returns 204, then 404 everywhere', function () {
        $category = Category::factory()->create(['name' => 'Old']);

        $this->withToken($this->token)
            ->deleteJson('/api/v1/admin/categories/'.$category->id)
            ->assertNoContent();

        expect(Category::withTrashed()->find($category->id)->trashed())->toBeTrue();

        $this->withToken($this->token)->getJson('/api/v1/admin/categories/'.$category->id)->assertNotFound();
        $this->withToken($this->token)->deleteJson('/api/v1/admin/categories/'.$category->id)->assertNotFound();

        $audit = lastAudit('category.deleted');
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($category->id);
    });

    it('returns 409 while the category still has products (even unavailable ones)', function () {
        $category = Category::factory()->create();
        Product::factory()->forCategory($category)->unavailable()->create();

        $this->withToken($this->token)
            ->deleteJson('/api/v1/admin/categories/'.$category->id)
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This category still has products. Move or delete them first.']);

        expect($category->fresh()->trashed())->toBeFalse()
            ->and(lastAudit('category.deleted'))->toBeNull();
    });

    it('allows deleting a category whose products are all soft-deleted', function () {
        $category = Category::factory()->create();
        Product::factory()->forCategory($category)->create()->delete();

        $this->withToken($this->token)
            ->deleteJson('/api/v1/admin/categories/'.$category->id)
            ->assertNoContent();
    });
});
