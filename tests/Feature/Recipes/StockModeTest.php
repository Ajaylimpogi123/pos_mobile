<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Support\Facades\DB;

/*
 * Ingredients, Recipes & Purchasing → J (Round B): product stock modes, the `track_stock`
 * compatibility and the admin switching rules.
 */

beforeEach(function () {
    seedRoles();
    mainBranch();
    Carbon::setTestNow('2026-09-29 04:00:00');

    $this->manager = userWithRole('manager');
    $this->token = tokenFor($this->manager);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);
});

afterEach(function () {
    Carbon::setTestNow();
});

describe('the stock_mode migration', function () {
    afterEach(function () {
        // MySQL DDL commits RefreshDatabase's transaction: the next test migrates fresh.
        RefreshDatabaseState::$migrated = false;
    });

    it('maps track_stock = true to own and everything else to none, and keeps track_stock derived', function () {
        $tracked = Product::factory()->forCategory($this->drinks)->create(['track_stock' => true]);
        $untracked = Product::factory()->forCategory($this->drinks)->create(['track_stock' => false]);
        $recipe = Product::factory()->forCategory($this->drinks)->stockMode(Product::STOCK_RECIPE)->create();

        $migration = require collect(glob(database_path('migrations/*_add_stock_mode_to_products_table.php')))->sole();

        $migration->down();
        expect(DB::table('products')->orderBy('id')->pluck('track_stock')->map(fn ($v) => (bool) $v)->all())
            ->toBe([true, false, false]);

        $migration->up();

        expect(DB::table('products')->orderBy('id')->pluck('stock_mode')->all())->toBe(['own', 'none', 'none'])
            ->and(DB::table('products')->orderBy('id')->pluck('track_stock')->map(fn ($v) => (bool) $v)->all())->toBe([true, false, false])
            ->and($tracked->fresh()->track_stock)->toBeTrue()
            ->and($untracked->fresh()->stock_mode)->toBe('none')
            ->and($recipe->fresh()->stock_mode)->toBe('none');

        // track_stock is a generated column: it follows stock_mode and can't be written directly.
        DB::table('products')->where('id', $untracked->id)->update(['stock_mode' => 'own']);
        expect((bool) DB::table('products')->where('id', $untracked->id)->value('track_stock'))->toBeTrue()
            ->and(fn () => DB::table('products')->where('id', $untracked->id)->update(['track_stock' => false]))->toThrow(Exception::class);
    });
});

describe('Product.stock_mode and track_stock', function () {
    it('creates with a stock_mode and derives track_stock', function (string $mode, bool $tracked) {
        $this->withToken($this->token)->postJson('/api/v1/admin/products', [
            'category_id' => $this->drinks->id, 'name' => 'Pancake', 'price_cents' => 12000, 'stock_mode' => $mode,
        ])
            ->assertCreated()
            ->assertJsonPath('data.stock_mode', $mode)
            ->assertJsonPath('data.track_stock', $tracked)
            ->assertJsonPath('data.stock_qty', $tracked ? 0 : null);

        expect(lastAudit('product.created')->changes)->toMatchArray([
            'stock_mode' => ['from' => null, 'to' => $mode],
            'track_stock' => ['from' => null, 'to' => $tracked],
        ]);
    })->with([
        'own' => ['own', true],
        'recipe' => ['recipe', false],
        'none' => ['none', false],
    ]);

    it('defaults to none', function () {
        $this->withToken($this->token)->postJson('/api/v1/admin/products', [
            'category_id' => $this->drinks->id, 'name' => 'Tea', 'price_cents' => 3000,
        ])->assertCreated()->assertJsonPath('data.stock_mode', 'none')->assertJsonPath('data.track_stock', false);
    });

    it('maps a track_stock sent by an existing client onto stock_mode', function () {
        $id = $this->withToken($this->token)->postJson('/api/v1/admin/products', [
            'category_id' => $this->drinks->id, 'name' => 'Water', 'price_cents' => 2000, 'track_stock' => true,
        ])->assertCreated()->assertJsonPath('data.stock_mode', 'own')->json('data.id');

        $this->withToken($this->token)->patchJson("/api/v1/admin/products/{$id}", ['track_stock' => false])
            ->assertOk()->assertJsonPath('data.stock_mode', 'none')->assertJsonPath('data.track_stock', false);

        // A recipe product sent `track_stock: false` (an old client saving the form) stays a recipe.
        $recipe = Product::factory()->forCategory($this->drinks)->stockMode(Product::STOCK_RECIPE)->create();
        $this->withToken($this->token)->patchJson("/api/v1/admin/products/{$recipe->id}", ['track_stock' => false, 'name' => 'Pancake'])
            ->assertOk()->assertJsonPath('data.stock_mode', 'recipe');

        // stock_mode wins over track_stock when both are sent.
        $this->withToken($this->token)->patchJson("/api/v1/admin/products/{$id}", ['track_stock' => true, 'stock_mode' => 'recipe'])
            ->assertOk()->assertJsonPath('data.stock_mode', 'recipe')->assertJsonPath('data.track_stock', false);
    });

    it('shows stock_mode on the POS read endpoint too', function () {
        Product::factory()->forCategory($this->drinks)->stockMode(Product::STOCK_RECIPE)->create();

        $this->withToken(tokenFor(userWithRole('cashier')))->getJson('/api/v1/products')
            ->assertOk()
            ->assertJsonPath('data.0.stock_mode', 'recipe')
            ->assertJsonPath('data.0.track_stock', false);
    });

    it('validates stock_mode', function (mixed $value, string $message) {
        $this->withToken($this->token)->postJson('/api/v1/admin/products', [
            'category_id' => $this->drinks->id, 'name' => 'Tea', 'price_cents' => 3000, 'stock_mode' => $value,
        ])->assertUnprocessable()->assertJsonValidationErrors(['stock_mode' => $message]);
    })->with([
        'unknown' => ['tracked', 'The selected stock mode is invalid.'],
        'null' => [null, 'The stock mode field is required.'],
    ]);
});

describe('switching stock modes', function () {
    beforeEach(function () {
        $this->water = Product::factory()->forCategory($this->drinks)->create(['name' => 'Water', 'track_stock' => true]);
        $this->url = '/api/v1/admin/products/'.$this->water->id;
    });

    it('refuses to leave own while there is stock (any branch), with 409', function (string $to) {
        stockUp($this->water, 3);

        $this->withToken($this->token)->patchJson($this->url, ['stock_mode' => $to])
            ->assertConflict()
            ->assertExactJson(['message' => 'Use up or write off the stock first.']);

        expect($this->water->fresh()->stock_mode)->toBe('own')
            ->and(AuditLog::query()->where('action', 'product.updated')->count())->toBe(0);
    })->with(['recipe', 'none']);

    it('leaves own once the stock is 0 or below, and audits the switch', function () {
        stockUp($this->water, 2);
        stockUp($this->water, -3);

        $this->withToken($this->token)->patchJson($this->url, ['stock_mode' => 'recipe'])
            ->assertOk()
            ->assertJsonPath('data.stock_mode', 'recipe')
            ->assertJsonPath('data.track_stock', false)
            ->assertJsonPath('data.stock_qty', null);

        expect(ksortDeep(lastAudit('product.updated')->changes))->toBe([
            'stock_mode' => ['from' => 'own', 'to' => 'recipe'],
            'track_stock' => ['from' => true, 'to' => false],
        ]);
    });

    it('switches freely into own, and between recipe and none keeping the recipe rows', function () {
        $pancake = Product::factory()->forCategory($this->drinks)->stockMode(Product::STOCK_RECIPE)->create();
        $flour = makeIngredient('Flour');
        DB::table('recipe_lines')->insert([
            'product_id' => $pancake->id, 'ingredient_id' => $flour->id, 'qty' => '100.000', 'unit' => 'g', 'base_qty' => '100.000',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $url = '/api/v1/admin/products/'.$pancake->id;

        $this->withToken($this->token)->patchJson($url, ['stock_mode' => 'none'])->assertOk()->assertJsonPath('data.stock_mode', 'none');
        expect(DB::table('recipe_lines')->where('product_id', $pancake->id)->count())->toBe(1);

        $this->withToken($this->token)->patchJson($url, ['stock_mode' => 'recipe'])->assertOk();
        $this->withToken($this->token)->patchJson($url, ['stock_mode' => 'own'])->assertOk()->assertJsonPath('data.stock_qty', 0);

        expect(lastAudit('product.updated')->changes)->toMatchArray([
            'stock_mode' => ['from' => 'recipe', 'to' => 'own'],
            'track_stock' => ['from' => false, 'to' => true],
        ]);
    });

    it('keeps the Phase 3 behaviour of own products: the online stock check blocks', function () {
        stockUp($this->water, 1);

        postOrder(userWithRole('cashier'), simpleSale([[$this->water, 2]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty' => 'Only 1 "Water" left in stock.']);
    });
});
