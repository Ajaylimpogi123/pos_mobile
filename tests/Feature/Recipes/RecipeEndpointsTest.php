<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\RecipeLine;
use App\Models\StockMovement;
use Carbon\Carbon;

/*
 * Ingredients, Recipes & Purchasing → J: GET/PUT /api/v1/admin/products/{id}/recipe and
 * POST …/recipe/apply-cost (permission product.manage).
 */

beforeEach(function () {
    seedRoles();
    mainBranch();
    Carbon::setTestNow('2026-09-29 04:00:00');

    $this->manager = userWithRole('manager');
    $this->token = tokenFor($this->manager);
    $breakfast = Category::factory()->create(['name' => 'Breakfast']);

    // Worked example J: Flour @ 4.666667 (example H), Egg @ 800, Milk @ 9.5.
    $this->flour = makeIngredient('Flour', 'g', ['cup' => '120', 'sack' => '25000']);
    $this->egg = makeIngredient('Egg', 'pc');
    $this->milk = makeIngredient('Milk', 'mL');
    ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000.000', 20000);
    ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '25000.000', 120000);
    ingredientMovement($this->egg, StockMovement::TYPE_RECEIPT, '30.000', 24000);
    ingredientMovement($this->milk, StockMovement::TYPE_RECEIPT, '2000.000', 19000);

    $this->pancake = Product::factory()->forCategory($breakfast)->stockMode(Product::STOCK_RECIPE)
        ->create(['name' => 'Pancake', 'price_cents' => 12000, 'cost_cents' => 0]);
    $this->water = Product::factory()->forCategory($breakfast)->create(['name' => 'Bottled Water', 'track_stock' => true, 'cost_cents' => 900]);
    $this->url = '/api/v1/admin/products/'.$this->pancake->id.'/recipe';
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * The recipe body of worked example J.
 *
 * @return array{lines: list<array<string, mixed>>}
 */
function exampleJRecipe(): array
{
    $t = test();

    return ['lines' => [
        ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'qty' => '1', 'unit' => 'cup'],
        ['component_type' => 'ingredient', 'component_id' => $t->egg->id, 'qty' => 1, 'unit' => 'pc'],
        ['component_type' => 'ingredient', 'component_id' => $t->milk->id, 'qty' => '0.5', 'unit' => 'cup'],
    ]];
}

describe('PUT recipe', function () {
    it('stores worked example J and returns the Recipe with its cost per serving (2484)', function () {
        $response = $this->withToken($this->token)->putJson($this->url, exampleJRecipe())->assertOk();

        $response->assertExactJson(['data' => [
            'lines' => [
                [
                    'component' => ['type' => 'ingredient', 'id' => $this->flour->id, 'name' => 'Flour', 'base_unit' => 'g'],
                    'qty' => '1.000', 'unit' => 'cup', 'base_qty' => '120.000',
                    'unit_cost' => '4.666667', 'line_cost_cents' => 560,
                ],
                [
                    'component' => ['type' => 'ingredient', 'id' => $this->egg->id, 'name' => 'Egg', 'base_unit' => 'pc'],
                    'qty' => '1.000', 'unit' => 'pc', 'base_qty' => '1.000',
                    'unit_cost' => '800.000000', 'line_cost_cents' => 800,
                ],
                [
                    'component' => ['type' => 'ingredient', 'id' => $this->milk->id, 'name' => 'Milk', 'base_unit' => 'mL'],
                    'qty' => '0.500', 'unit' => 'cup', 'base_qty' => '118.294',
                    'unit_cost' => '9.500000', 'line_cost_cents' => 1124,
                ],
            ],
            'cost_cents' => 2484,
            'price_cents' => 12000,
            'margin_bps' => 7930,
        ]]);

        expect(RecipeLine::query()->where('product_id', $this->pancake->id)->orderBy('id')->get(['qty', 'unit', 'base_qty'])->toArray())->toBe([
            ['qty' => '1.000', 'unit' => 'cup', 'base_qty' => '120.000'],
            ['qty' => '1.000', 'unit' => 'pc', 'base_qty' => '1.000'],
            ['qty' => '0.500', 'unit' => 'cup', 'base_qty' => '118.294'],
        ]);

        $audit = lastAudit('recipe.updated');
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($this->pancake->id)
            ->and($audit->changes['lines']['from'])->toBe([])
            ->and($audit->changes['lines']['to'][2])->toMatchArray(['component_type' => 'ingredient', 'name' => 'Milk', 'qty' => '0.500', 'unit' => 'cup', 'base_qty' => '118.294']);
    });

    it('accepts an own product component (pc, whole), with integer quantities and its cost_cents', function () {
        $this->withToken($this->token)->putJson($this->url, ['lines' => [
            ['component_type' => 'product', 'component_id' => $this->water->id, 'qty' => 2, 'unit' => 'pc'],
        ]])
            ->assertOk()
            ->assertJsonPath('data.lines.0', [
                'component' => ['type' => 'product', 'id' => $this->water->id, 'name' => 'Bottled Water', 'base_unit' => 'pc'],
                'qty' => 2, 'unit' => 'pc', 'base_qty' => 2, 'unit_cost' => '900.000000', 'line_cost_cents' => 1800,
            ])
            ->assertJsonPath('data.cost_cents', 1800);
    });

    it('replaces the recipe as a set, clears it with no lines, and writes no audit when unchanged', function () {
        $this->withToken($this->token)->putJson($this->url, exampleJRecipe())->assertOk();
        $this->withToken($this->token)->putJson($this->url, exampleJRecipe())->assertOk();

        expect(AuditLog::query()->where('action', 'recipe.updated')->count())->toBe(1);

        $this->withToken($this->token)->putJson($this->url, ['lines' => [
            ['component_type' => 'ingredient', 'component_id' => $this->egg->id, 'qty' => 2, 'unit' => 'pc'],
        ]])->assertOk()->assertJsonCount(1, 'data.lines')->assertJsonPath('data.cost_cents', 1600);

        $this->withToken($this->token)->putJson($this->url, ['lines' => []])
            ->assertOk()
            ->assertExactJson(['data' => ['lines' => [], 'cost_cents' => 0, 'price_cents' => 12000, 'margin_bps' => null]]);

        expect(RecipeLine::query()->count())->toBe(0)
            ->and(AuditLog::query()->where('action', 'recipe.updated')->count())->toBe(3);
    });

    it('rejects invalid lines with 422', function (Closure $line, string $field, string $message) {
        $this->withToken($this->token)->putJson($this->url, ['lines' => [$line($this)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(RecipeLine::query()->count())->toBe(0);
    })->with([
        'unknown unit' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'qty' => 3, 'unit' => 'tbsp'], 'lines.0.unit', 'Add "tbsp" to Flour\'s units first.'],
        'zero qty' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'qty' => 0, 'unit' => 'g'], 'lines.0.qty', 'The lines.0.qty field must be greater than 0.'],
        '4 decimals' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'qty' => '1.0005', 'unit' => 'g'], 'lines.0.qty', 'The lines.0.qty field must be a number with at most 3 decimals.'],
        'too small' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'qty' => '0.001', 'unit' => 'mg'], 'lines.0.qty', 'The quantity is too small for this unit.'],
        'bad type' => [fn ($t) => ['component_type' => 'recipe', 'component_id' => $t->flour->id, 'qty' => 1, 'unit' => 'g'], 'lines.0.component_type', 'The selected lines.0.component_type is invalid.'],
        'missing component' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => 999999, 'qty' => 1, 'unit' => 'g'], 'lines.0.component_id', 'The selected item is invalid.'],
        'inactive ingredient' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => makeIngredient('Old Flour', 'g', [], ['is_active' => false])->id, 'qty' => 1, 'unit' => 'g'], 'lines.0.component_id', 'This ingredient is inactive.'],
        'product without stock' => [fn ($t) => ['component_type' => 'product', 'component_id' => Product::factory()->create()->id, 'qty' => 1, 'unit' => 'pc'], 'lines.0.component_id', 'Only items with their own stock can be components.'],
        'nested recipe product' => [fn ($t) => ['component_type' => 'product', 'component_id' => Product::factory()->stockMode(Product::STOCK_RECIPE)->create()->id, 'qty' => 1, 'unit' => 'pc'], 'lines.0.component_id', 'Only items with their own stock can be components.'],
        'itself' => [fn ($t) => ['component_type' => 'product', 'component_id' => $t->pancake->id, 'qty' => 1, 'unit' => 'pc'], 'lines.0.component_id', 'Only items with their own stock can be components.'],
        'fractional product' => [fn ($t) => ['component_type' => 'product', 'component_id' => $t->water->id, 'qty' => '0.5', 'unit' => 'pc'], 'lines.0.qty', 'A product quantity must be a whole number.'],
        'product unit' => [fn ($t) => ['component_type' => 'product', 'component_id' => $t->water->id, 'qty' => 1, 'unit' => 'g'], 'lines.0.unit', 'Add "g" to Bottled Water\'s units first.'],
        'no qty' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'unit' => 'g'], 'lines.0.qty', 'The lines.0.qty field is required.'],
        'no unit' => [fn ($t) => ['component_type' => 'ingredient', 'component_id' => $t->flour->id, 'qty' => 1], 'lines.0.unit', 'The lines.0.unit field is required.'],
    ]);

    it('rejects a duplicate component and more than 50 lines', function () {
        $this->withToken($this->token)->putJson($this->url, ['lines' => [
            ['component_type' => 'ingredient', 'component_id' => $this->flour->id, 'qty' => 1, 'unit' => 'cup'],
            ['component_type' => 'ingredient', 'component_id' => $this->flour->id, 'qty' => 10, 'unit' => 'g'],
        ]])->assertUnprocessable()->assertJsonValidationErrors(['lines.1.component_id' => 'This component is already on the recipe.']);

        $this->withToken($this->token)->putJson($this->url, ['lines' => array_fill(0, 51, ['component_type' => 'ingredient', 'component_id' => $this->flour->id, 'qty' => 1, 'unit' => 'g'])])
            ->assertUnprocessable()->assertJsonValidationErrors(['lines' => 'Use at most 50 components.']);

        $this->withToken($this->token)->putJson($this->url, [])
            ->assertUnprocessable()->assertJsonValidationErrors(['lines' => 'The lines field must be present.']);
    });

    it('returns 409 for a product that is not a recipe product', function () {
        $this->withToken($this->token)->putJson('/api/v1/admin/products/'.$this->water->id.'/recipe', ['lines' => []])
            ->assertConflict()
            ->assertExactJson(['message' => "This product doesn't use a recipe."]);
    });

    it('returns 401, 403 and 404', function () {
        $this->putJson($this->url, exampleJRecipe())->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);

        $this->withToken(tokenFor(userWithRole('cashier')))->putJson($this->url, exampleJRecipe())
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);

        $this->withToken($this->token)->putJson('/api/v1/admin/products/999999/recipe', exampleJRecipe())
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
    });
});

describe('GET recipe', function () {
    it('returns the recipe at the caller\'s branch costs', function () {
        $this->withToken($this->token)->putJson($this->url, exampleJRecipe())->assertOk();

        $this->withToken($this->token)->getJson($this->url)
            ->assertOk()
            ->assertJsonPath('data.cost_cents', 2484)
            ->assertJsonCount(3, 'data.lines');
    });

    it('keeps returning the rows after a switch away from recipe', function () {
        $this->withToken($this->token)->putJson($this->url, exampleJRecipe())->assertOk();
        $this->pancake->update(['stock_mode' => Product::STOCK_NONE]);

        $this->withToken($this->token)->getJson($this->url)->assertOk()->assertJsonCount(3, 'data.lines');
    });

    it('returns an empty recipe, 401, 403 and 404', function () {
        $this->withToken($this->token)->getJson($this->url)
            ->assertOk()
            ->assertExactJson(['data' => ['lines' => [], 'cost_cents' => 0, 'price_cents' => 12000, 'margin_bps' => null]]);

        $this->withoutToken()->getJson($this->url)->assertUnauthorized();
        $this->withToken(tokenFor(userWithRole('cashier')))->getJson($this->url)->assertForbidden();
        $this->withToken($this->token)->getJson('/api/v1/admin/products/999999/recipe')->assertNotFound();
    });
});

describe('POST recipe/apply-cost', function () {
    it('sets the product cost to the recipe cost, audited, and returns the admin Product', function () {
        $this->withToken($this->token)->putJson($this->url, exampleJRecipe())->assertOk();

        $response = $this->withToken($this->token)->postJson($this->url.'/apply-cost')
            ->assertOk()
            ->assertJsonPath('data.id', $this->pancake->id)
            ->assertJsonPath('data.cost_cents', 2484)
            ->assertJsonPath('data.stock_mode', 'recipe')
            ->assertJsonPath('data.stock_qty', null);

        expect(array_keys($response->json('data')))->toBe(productKeys(withCost: true));

        expect($this->pancake->fresh()->cost_cents)->toBe(2484)
            ->and(ksortDeep(lastAudit('product.updated')->changes))->toBe(['cost_cents' => ['from' => 0, 'to' => 2484]]);

        // Unchanged: nothing written.
        $this->withToken($this->token)->postJson($this->url.'/apply-cost')->assertOk();
        expect(AuditLog::query()->where('action', 'product.updated')->count())->toBe(1);

        $this->withToken($this->token)->getJson('/api/v1/admin/products/'.$this->pancake->id)->assertJsonPath('data.cost_cents', 2484);
    });

    it('returns 409 for a non-recipe product, 401, 403 and 404', function () {
        $this->withToken($this->token)->postJson('/api/v1/admin/products/'.$this->water->id.'/recipe/apply-cost')
            ->assertConflict()->assertExactJson(['message' => "This product doesn't use a recipe."]);
        $this->withoutToken()->postJson($this->url.'/apply-cost')->assertUnauthorized();
        $this->withToken(tokenFor(userWithRole('cashier')))->postJson($this->url.'/apply-cost')->assertForbidden();
        $this->withToken($this->token)->postJson('/api/v1/admin/products/999999/recipe/apply-cost')->assertNotFound();

        expect($this->water->fresh()->cost_cents)->toBe(900);
    });
});

describe('ingredient guards', function () {
    it('blocks deleting an ingredient on a recipe and locks its base unit', function () {
        $sugar = makeIngredient('Sugar');
        $this->withToken($this->token)->getJson('/api/v1/admin/ingredients/'.$sugar->id)->assertJsonPath('data.base_unit_locked', false);

        $this->withToken($this->token)->putJson($this->url, ['lines' => [
            ['component_type' => 'ingredient', 'component_id' => $sugar->id, 'qty' => 10, 'unit' => 'g'],
        ]])->assertOk();

        $this->withToken($this->token)->getJson('/api/v1/admin/ingredients/'.$sugar->id)->assertJsonPath('data.base_unit_locked', true);
        $this->withToken($this->token)->patchJson('/api/v1/admin/ingredients/'.$sugar->id, ['base_unit' => 'mL'])
            ->assertConflict()->assertExactJson(['message' => "The base unit can't change once the ingredient is in use."]);

        $this->withToken($this->token)->deleteJson('/api/v1/admin/ingredients/'.$sugar->id)
            ->assertConflict()->assertExactJson(['message' => 'This ingredient is on a recipe. Remove it from the recipe first.']);

        // Once the recipe product is deleted, its lines no longer block the delete.
        $this->pancake->delete();
        $this->withToken($this->token)->deleteJson('/api/v1/admin/ingredients/'.$sugar->id)->assertNoContent();
    });
});
