<?php

use App\Models\Ingredient;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-28 02:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->cashier = userWithRole('cashier');
});

afterEach(function () {
    Carbon::setTestNow();
});

function ingredientBody(array $overrides = []): array
{
    return [
        'name' => 'Flour',
        'base_unit' => 'g',
        'units' => [['name' => 'sack', 'factor' => '25000'], ['name' => 'cup', 'factor' => 120]],
        ...$overrides,
    ];
}

describe('create and read', function () {
    it('creates an ingredient with its units (201) and the branch stock fields', function () {
        $response = $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/ingredients', ingredientBody())->assertCreated();

        expect(array_keys($response->json('data')))->toBe(ingredientKeys())
            ->and($response->json('data'))->toMatchArray([
                'name' => 'Flour', 'base_unit' => 'g', 'image_url' => null, 'image_path' => null, 'is_active' => true,
                'qty' => '0.000', 'reorder_level' => null, 'status' => 'out', 'avg_cost' => '0.000000',
                'stock_value_cents' => 0, 'last_movement_at' => null,
            ])
            ->and(collect($response->json('data.units'))->map(fn ($u) => [$u['name'], $u['factor']])->all())->toBe([['sack', '25000'], ['cup', '120']]);

        expect(lastAudit('ingredient.created')->changes['units']['to'])->toBe([
            ['name' => 'sack', 'factor' => '25000'], ['name' => 'cup', 'factor' => '120'],
        ]);
    });

    it('shows the caller branch stock', function () {
        $flour = makeIngredient('Flour', 'g', ['sack' => '25000']);
        ingredientMovement($flour, StockMovement::TYPE_RECEIPT, '5000', 20000);

        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/admin/ingredients/{$flour->id}")
            ->assertOk()
            ->assertJsonPath('data.qty', '5000.000')
            ->assertJsonPath('data.avg_cost', '4.000000')
            ->assertJsonPath('data.stock_value_cents', 20000)
            ->assertJsonPath('data.status', 'in_stock')
            ->assertJsonPath('data.last_movement_at', '2026-09-28T02:00:00Z');
    });

    it('lists with search, is_active and the cursor envelope', function () {
        makeIngredient('Flour');
        makeIngredient('Milk', 'mL', [], ['is_active' => false]);
        makeIngredient('Egg', 'pc');

        $token = tokenFor($this->manager);
        $page = $this->withToken($token)->getJson('/api/v1/admin/ingredients?per_page=2')->assertOk();

        expect(collect($page->json('data'))->pluck('name')->all())->toBe(['Egg', 'Flour'])
            ->and($page->json('meta.next_cursor'))->toBeString();

        expect(collect($this->withToken($token)->getJson('/api/v1/admin/ingredients?is_active=false')->json('data'))->pluck('name')->all())->toBe(['Milk'])
            ->and(collect($this->withToken($token)->getJson('/api/v1/admin/ingredients?search=lou')->json('data'))->pluck('name')->all())->toBe(['Flour']);
    });
});

describe('validation', function () {
    it('requires name and base unit, and checks base_unit', function () {
        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/ingredients', ['base_unit' => 'kg'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'base_unit']);
    });

    it('refuses a unit reusing a catalog code of the same dimension, and allows another dimension\'s', function () {
        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/ingredients', ingredientBody([
            'units' => [['name' => 'kg', 'factor' => '1000']],
        ]))->assertUnprocessable()->assertJsonPath('errors', ['units.0.name' => ['"kg" is already a standard unit.']]);

        // `cup` is a volume code: a density on a mass ingredient is fine.
        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/ingredients', ingredientBody([
            'units' => [['name' => 'cup', 'factor' => '120']],
        ]))->assertCreated();
    });

    it('checks the unit set', function () {
        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/ingredients', ingredientBody([
            'name' => 'Sugar',
            'units' => [
                ['name' => 'sack', 'factor' => '0'],
                ['name' => 'SACK', 'factor' => '1.12345678901'],
                ['name' => str_repeat('x', 21), 'factor' => '1000001'],
            ],
        ]))->assertUnprocessable()->assertJsonValidationErrors([
            'units.0.factor', 'units.1.name', 'units.1.factor', 'units.2.name', 'units.2.factor',
        ]);
    });

    it('refuses a duplicate name among non-deleted ingredients', function () {
        makeIngredient('Flour');

        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/ingredients', ingredientBody(['name' => 'flour']))
            ->assertUnprocessable()->assertJsonValidationErrors(['name']);
    });
});

describe('update', function () {
    it('replaces the units by id: updates in place, adds and removes', function () {
        $flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
        [$sack, $cup] = $flour->units->all();

        $response = $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/admin/ingredients/{$flour->id}", [
            'units' => [['id' => $sack->id, 'name' => 'sack', 'factor' => '50000'], ['name' => 'bag', 'factor' => '1000']],
        ])->assertOk();

        expect(collect($response->json('data.units'))->map(fn ($u) => [$u['id'], $u['name'], $u['factor']])->all())
            ->toBe([[$sack->id, 'sack', '50000'], [$response->json('data.units.1.id'), 'bag', '1000']])
            ->and($flour->units()->whereKey($cup->id)->exists())->toBeFalse();

        expect(lastAudit('ingredient.updated')->changes['units']['to'])->toBe([
            ['name' => 'sack', 'factor' => '50000'], ['name' => 'bag', 'factor' => '1000'],
        ]);
    });

    it('refuses a unit id of another ingredient', function () {
        $flour = makeIngredient('Flour', 'g', ['sack' => '25000']);
        $sugar = makeIngredient('Sugar', 'g', ['bag' => '1000']);

        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/admin/ingredients/{$flour->id}", [
            'units' => [['id' => $sugar->units->first()->id, 'name' => 'bag', 'factor' => '1']],
        ])->assertUnprocessable()->assertJsonValidationErrors(['units.0.id']);
    });

    it('changes the base unit until the ingredient is in use, then 409', function () {
        $flour = makeIngredient('Flour');
        $token = tokenFor($this->manager);

        $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", ['base_unit' => 'mL'])
            ->assertOk()->assertJsonPath('data.base_unit', 'mL')->assertJsonPath('data.base_unit_locked', false);

        ingredientMovement($flour, StockMovement::TYPE_RECEIPT, '100', 400);

        $this->withToken($token)->getJson("/api/v1/admin/ingredients/{$flour->id}")->assertJsonPath('data.base_unit_locked', true);

        $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", ['base_unit' => 'g'])
            ->assertConflict()
            ->assertExactJson(['message' => "The base unit can't change once the ingredient is in use."]);
    });

    it('refuses to remove or re-factor a unit on an open PO line (409), and allows other edits', function () {
        $flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
        [$sack, $cup] = $flour->units->all();
        approveAllItems($this->owner, createPurchaseRequest($this->manager, [prItem($flour, makeSupplier(), '2', 'sack', ['estimated_unit_price_cents' => 120000])]));
        $token = tokenFor($this->manager);

        $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", [
            'units' => [['id' => $sack->id, 'name' => 'sack', 'factor' => '30000'], ['id' => $cup->id, 'name' => 'cup', 'factor' => '120']],
        ])->assertConflict()->assertExactJson(['message' => 'The unit "sack" is on an open purchase order.']);

        $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", [
            'units' => [['id' => $cup->id, 'name' => 'cup', 'factor' => '120']],
        ])->assertConflict();

        $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", [
            'units' => [['id' => $sack->id, 'name' => 'sack', 'factor' => '25000'], ['id' => $cup->id, 'name' => 'cup', 'factor' => '125']],
        ])->assertOk();
    });
});

describe('delete and image', function () {
    it('soft-deletes an unused ingredient (204)', function () {
        $flour = makeIngredient('Flour');

        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/admin/ingredients/{$flour->id}")->assertNoContent();

        expect(Ingredient::withTrashed()->find($flour->id)->trashed())->toBeTrue()
            ->and(lastAudit('ingredient.deleted')->changes)->toBe(['name' => 'Flour']);
    });

    it('refuses an ingredient on an open PO (409)', function () {
        $flour = makeIngredient('Flour');
        approveAllItems($this->owner, createPurchaseRequest($this->manager, [prItem($flour, makeSupplier(), '1', 'kg')]));

        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/admin/ingredients/{$flour->id}")
            ->assertConflict()->assertExactJson(['message' => 'This ingredient is on an open purchase order.']);
    });

    it('stores and removes an image', function () {
        fakeCatalogImageDisk();
        $flour = makeIngredient('Flour');
        $token = tokenFor($this->manager);

        $response = $this->withToken($token)->post("/api/v1/admin/ingredients/{$flour->id}/image", ['image' => fakeWebp('flour.webp', 200, 200)], ['Accept' => 'application/json'])
            ->assertOk();

        expect($response->json('data.image_path'))->toStartWith("ingredients/{$flour->id}/")
            ->and($response->json('data.image_url'))->toStartWith('http');

        $this->withToken($token)->deleteJson("/api/v1/admin/ingredients/{$flour->id}/image")
            ->assertOk()->assertJsonPath('data.image_path', null);
    });
});

describe('permissions', function () {
    it('needs a token', function () {
        $this->getJson('/api/v1/admin/ingredients')->assertUnauthorized();
    });

    it('refuses a cashier (403)', function () {
        $flour = makeIngredient('Flour');
        $token = tokenFor($this->cashier);

        $this->withToken($token)->getJson('/api/v1/admin/ingredients')->assertForbidden();
        $this->withToken($token)->postJson('/api/v1/admin/ingredients', ingredientBody())->assertForbidden();
        $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", ['name' => 'X'])->assertForbidden();
        $this->withToken($token)->deleteJson("/api/v1/admin/ingredients/{$flour->id}")->assertForbidden();
    });

    it('lets inventory.adjust and purchase roles read, not write', function () {
        $flour = makeIngredient('Flour');

        foreach (['inventory.adjust', 'purchase.request', 'report.view'] as $i => $slug) {
            $user = User::factory()->forBranch($this->branch)->create(['role_id' => customRole("reader{$i}", [$slug])->id]);
            $token = tokenFor($user);

            $this->withToken($token)->getJson("/api/v1/admin/ingredients/{$flour->id}")->assertOk();
            $this->withToken($token)->patchJson("/api/v1/admin/ingredients/{$flour->id}", ['name' => 'X'])->assertForbidden();
        }
    });

    it('returns 404 for an unknown ingredient', function () {
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/admin/ingredients/999999')->assertNotFound();
    });
});
