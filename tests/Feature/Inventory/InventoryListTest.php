<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-27 05:10:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);
    $this->snacks = Category::factory()->create(['name' => 'Snacks']);

    $make = fn (Category $category, array $attributes) => Product::factory()->forCategory($category)->create(['track_stock' => true, ...$attributes]);

    $this->icedTea = $make($this->drinks, ['name' => 'Iced Tea', 'sku' => 'DRK-001', 'cost_cents' => 1200]);
    $this->water = $make($this->drinks, ['name' => 'Bottled Water', 'sku' => 'DRK-002', 'cost_cents' => 1000]);
    $this->soda = $make($this->drinks, ['name' => 'Soda', 'sku' => 'DRK-003', 'cost_cents' => 900]);
    $this->chips = $make($this->snacks, ['name' => 'Chips', 'sku' => 'SNK-001', 'cost_cents' => 500, 'is_available' => false]);
    $this->hotDog = $make($this->snacks, ['name' => 'Hot Dog', 'track_stock' => false]);
    $this->gone = $make($this->snacks, ['name' => 'Discontinued']);
    $this->gone->delete();

    recordMovement($this->icedTea, 'opening', 35, '2026-09-26 01:00:00');
    recordMovement($this->icedTea, 'sale', -26, '2026-09-27 05:10:00');
    setReorderLevel($this->icedTea, 10);          // 9 ≤ 10: low
    stockUp($this->water, 30);
    setReorderLevel($this->water, 10);            // in stock
    // Soda never stocked: out. Chips: 5, no reorder level: in stock.
    stockUp($this->chips, 5);
});

afterEach(function () {
    Carbon::setTestNow();
});

function listInventory(User $user, string $query = ''): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/inventory'.($query === '' ? '' : "?{$query}"));
}

describe('GET /inventory', function () {
    it('returns the branch\'s tracked products as InventoryItems ordered by name, with the summary', function () {
        $response = listInventory($this->manager)->assertOk();

        $response->assertJsonStructure([
            'data' => [inventoryItemKeys()],
            'links' => ['first', 'last', 'prev', 'next'],
            'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'summary' => ['tracked', 'low', 'out']],
        ]);

        expect(array_column($response->json('data'), 'name'))->toBe(['Bottled Water', 'Chips', 'Iced Tea', 'Soda'])
            ->and(array_keys($response->json('data.0')))->toBe(inventoryItemKeys())
            ->and($response->json('meta.summary'))->toBe(['tracked' => 4, 'low' => 1, 'out' => 1])
            ->and($response->json('meta.per_page'))->toBe(25)
            ->and($response->json('meta.next_cursor'))->toBeNull();

        expect($response->json('data.2'))->toBe([
            'product_id' => $this->icedTea->id,
            'name' => 'Iced Tea',
            'sku' => 'DRK-001',
            'category' => ['id' => $this->drinks->id, 'name' => 'Drinks'],
            'image_url' => null,
            'is_available' => true,
            'qty' => 9,
            'reorder_level' => 10,
            'status' => 'low',
            'cost_cents' => 1200,
            'stock_value_cents' => 10800,
            'last_movement_at' => '2026-09-27T05:10:00Z',
        ]);

        expect(collect($response->json('data'))->keyBy('name')->map(fn (array $item) => [$item['qty'], $item['reorder_level'], $item['status'], $item['stock_value_cents'], $item['is_available']])->all())
            ->toBe([
                'Bottled Water' => [30, 10, 'in_stock', 30000, true],
                'Chips' => [5, null, 'in_stock', 2500, false],
                'Iced Tea' => [9, 10, 'low', 10800, true],
                'Soda' => [0, null, 'out', 0, true],
            ])
            ->and($response->json('data.3.last_movement_at'))->toBeNull();
    });

    it('derives the status at the boundaries', function (int $qty, ?int $reorderLevel, string $status, int $value) {
        $tea = Product::factory()->forCategory($this->drinks)->create(['name' => 'Aa Test', 'track_stock' => true, 'cost_cents' => 100]);

        if ($qty !== 0) {
            stockUp($tea, $qty);
        }

        if ($reorderLevel !== null) {
            setReorderLevel($tea, $reorderLevel);
        }

        listInventory($this->manager)
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Aa Test')
            ->assertJsonPath('data.0.qty', $qty)
            ->assertJsonPath('data.0.status', $status)
            ->assertJsonPath('data.0.stock_value_cents', $value);
    })->with([
        'at the reorder level' => [10, 10, 'low', 1000],
        'one above' => [11, 10, 'in_stock', 1100],
        'zero with a level' => [0, 10, 'out', 0],
        'zero without a level' => [0, null, 'out', 0],
        'negative' => [-3, 5, 'out', 0],
        'level 0, qty 0' => [0, 0, 'out', 0],
        'level 0, qty 1' => [1, 0, 'in_stock', 100],
        'no level' => [1, null, 'in_stock', 100],
    ]);

    it('filters by status, keeping the whole-branch summary', function (string $status, array $names) {
        $response = listInventory($this->manager, "status={$status}")->assertOk();

        expect(array_column($response->json('data'), 'name'))->toBe($names)
            ->and($response->json('meta.summary'))->toBe(['tracked' => 4, 'low' => 1, 'out' => 1]);
    })->with([
        'low' => ['low', ['Iced Tea']],
        'out' => ['out', ['Soda']],
        'in_stock' => ['in_stock', ['Bottled Water', 'Chips']],
        'alerts' => ['alerts', ['Iced Tea', 'Soda']],
    ]);

    it('searches the name or SKU, case-insensitively, and filters by category', function () {
        $names = fn (string $query) => array_column(listInventory($this->manager, $query)->assertOk()->json('data'), 'name');

        expect($names('search=TEA'))->toBe(['Iced Tea'])
            ->and($names('search=drk-00'))->toBe(['Bottled Water', 'Iced Tea', 'Soda'])
            ->and($names('search=snk'))->toBe(['Chips'])
            ->and($names('search=100%25'))->toBe([])
            ->and($names("category_id={$this->snacks->id}"))->toBe(['Chips'])
            ->and($names("category_id={$this->drinks->id}&status=alerts&search=o"))->toBe(['Soda']);
    });

    it('pages with the cursor, carrying the summary on every page', function () {
        $first = listInventory($this->manager, 'per_page=3')->assertOk();

        expect(array_column($first->json('data'), 'name'))->toBe(['Bottled Water', 'Chips', 'Iced Tea'])
            ->and($first->json('meta.next_cursor'))->not->toBeNull();

        $second = listInventory($this->manager, 'per_page=3&cursor='.$first->json('meta.next_cursor'))->assertOk();

        expect(array_column($second->json('data'), 'name'))->toBe(['Soda'])
            ->and($second->json('meta.next_cursor'))->toBeNull()
            ->and($second->json('meta.summary'))->toBe(['tracked' => 4, 'low' => 1, 'out' => 1]);
    });

    it('orders products with the same name by id', function () {
        $twin = Product::factory()->forCategory($this->drinks)->create(['name' => 'Iced Tea', 'track_stock' => true]);

        $ids = array_column(listInventory($this->manager, 'search=iced')->assertOk()->json('data'), 'product_id');

        expect($ids)->toBe([$this->icedTea->id, $twin->id]);
    });

    it('covers the caller\'s branch only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        stockUp($this->soda, 4, $north);
        setReorderLevel($this->soda, 5, $north);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();

        $response = listInventory($northManager)->assertOk();

        expect(collect($response->json('data'))->pluck('status', 'name')->all())->toBe([
            'Bottled Water' => 'out', 'Chips' => 'out', 'Iced Tea' => 'out', 'Soda' => 'low',
        ])
            ->and($response->json('meta.summary'))->toBe(['tracked' => 4, 'low' => 1, 'out' => 3])
            ->and($response->json('data.2.last_movement_at'))->toBeNull();
    });

    it('validates the query', function (string $query, string $field) {
        listInventory($this->manager, $query)->assertUnprocessable()->assertJsonValidationErrors([$field]);
    })->with([
        'status' => ['status=empty', 'status'],
        'search too long' => ['search='.str_repeat('a', 101), 'search'],
        'category' => ['category_id=abc', 'category_id'],
        'per_page too big' => ['per_page=101', 'per_page'],
        'per_page zero' => ['per_page=0', 'per_page'],
    ]);

    it('is open to inventory.adjust or report.view', function (array $permissions) {
        $user = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('custom', $permissions)->id]);

        listInventory($user)->assertOk();
    })->with([
        'inventory.adjust' => [['inventory.adjust']],
        'report.view' => [['report.view']],
    ]);

    it('returns 403 without inventory.adjust or report.view', function () {
        listInventory(userWithRole('cashier'))->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);

        $menu = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('menu-editor', ['product.manage'])->id]);
        listInventory($menu)->assertForbidden();
    });

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/inventory')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

describe('PUT /inventory/{product}/reorder-level', function () {
    function putReorderLevel(User $user, Product|int $product, array $body): TestResponse
    {
        $id = $product instanceof Product ? $product->id : $product;

        return test()->withToken(tokenFor($user))->putJson("/api/v1/inventory/{$id}/reorder-level", $body);
    }

    it('creates the level row when missing and returns the InventoryItem', function () {
        $response = putReorderLevel($this->manager, $this->soda, ['reorder_level' => 6])->assertOk();

        expect(array_keys($response->json('data')))->toBe(inventoryItemKeys())
            ->and($response->json('data'))->toMatchArray([
                'product_id' => $this->soda->id, 'qty' => 0, 'reorder_level' => 6, 'status' => 'out', 'stock_value_cents' => 0,
            ]);

        $audit = lastAudit('stock.reorder_level_changed');
        expect(stockOf($this->soda))->toBe(0)
            ->and($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($this->soda->id)
            ->and($audit->subject_type)->toBe($this->soda->getMorphClass())
            ->and(ksortDeep($audit->changes))->toBe(['reorder_level' => ['from' => null, 'to' => 6]]);

        // The new row holds qty 0 with no movement: the ledger (empty, so 0) still reconciles.
        expect(StockLevel::query()->where('product_id', $this->soda->id)->sole()->wholeQty())->toBe(0)
            ->and(StockMovement::query()->where('product_id', $this->soda->id)->exists())->toBeFalse();
    });

    it('changes the status with the level and writes the audit only on change', function () {
        putReorderLevel($this->manager, $this->water, ['reorder_level' => 30])
            ->assertOk()
            ->assertJsonPath('data.status', 'low')
            ->assertJsonPath('data.reorder_level', 30);

        putReorderLevel($this->manager, $this->water, ['reorder_level' => 30])->assertOk();

        expect(AuditLog::query()->where('action', 'stock.reorder_level_changed')->count())->toBe(1)
            ->and(ksortDeep(lastAudit('stock.reorder_level_changed')->changes))->toBe(['reorder_level' => ['from' => 10, 'to' => 30]]);
    });

    it('turns the alert off with null', function () {
        putReorderLevel($this->manager, $this->icedTea, ['reorder_level' => null])
            ->assertOk()
            ->assertJsonPath('data.reorder_level', null)
            ->assertJsonPath('data.status', 'in_stock');

        putReorderLevel($this->manager, $this->soda, ['reorder_level' => null])->assertOk();

        expect(AuditLog::query()->where('action', 'stock.reorder_level_changed')->count())->toBe(1)
            ->and(ksortDeep(lastAudit('stock.reorder_level_changed')->changes))->toBe(['reorder_level' => ['from' => 10, 'to' => null]]);
    });

    it('sets the level of the caller\'s branch only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();

        putReorderLevel($northManager, $this->icedTea, ['reorder_level' => 3])->assertOk()->assertJsonPath('data.qty', 0);

        listInventory($this->manager, 'search=iced')->assertJsonPath('data.0.reorder_level', 10);
    });

    it('returns 409 for a product that does not track stock, after validation', function () {
        putReorderLevel($this->manager, $this->hotDog, ['reorder_level' => 5])
            ->assertConflict()
            ->assertExactJson(['message' => "This product doesn't track stock."]);

        putReorderLevel($this->manager, $this->hotDog, [])->assertUnprocessable();

        expect(StockLevel::query()->where('product_id', $this->hotDog->id)->exists())->toBeFalse();
    });

    it('validates reorder_level', function (array $body, string $message) {
        putReorderLevel($this->manager, $this->icedTea, $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reorder_level' => $message]);
    })->with([
        'missing' => [[], 'The reorder level field must be present.'],
        'text' => [['reorder_level' => 'ten'], 'The reorder level field must be an integer.'],
        'fraction' => [['reorder_level' => 2.5], 'The reorder level field must be an integer.'],
        'negative' => [['reorder_level' => -1], 'The reorder level field must be between 0 and 100000.'],
        'too big' => [['reorder_level' => 100001], 'The reorder level field must be between 0 and 100000.'],
    ]);

    it('accepts the bounds', function (int $level) {
        putReorderLevel($this->manager, $this->icedTea, ['reorder_level' => $level])->assertOk()->assertJsonPath('data.reorder_level', $level);
    })->with([0, 100000]);

    it('needs inventory.adjust', function () {
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);
        $clerk = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('clerk', ['inventory.adjust'])->id]);

        putReorderLevel($viewer, $this->icedTea, ['reorder_level' => 1])->assertForbidden();
        putReorderLevel(userWithRole('cashier'), $this->icedTea, ['reorder_level' => 1])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
        putReorderLevel($clerk, $this->icedTea, ['reorder_level' => 1])->assertOk();
    });

    it('returns 404 for an unknown or deleted product', function () {
        putReorderLevel($this->manager, 999999, ['reorder_level' => 1])->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        putReorderLevel($this->manager, $this->gone->id, ['reorder_level' => 1])->assertNotFound();
    });

    it('returns 401 without a token', function () {
        $this->putJson("/api/v1/inventory/{$this->icedTea->id}/reorder-level", ['reorder_level' => 1])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

describe('GET /inventory/{product} (Q-020)', function () {
    function showInventoryItem(User $user, Product|int $product): TestResponse
    {
        $id = $product instanceof Product ? $product->id : $product;

        return test()->withToken(tokenFor($user))->getJson("/api/v1/inventory/{$id}");
    }

    it('returns the product\'s InventoryItem, as the list does', function () {
        $response = showInventoryItem($this->manager, $this->icedTea)->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and($response->json('data'))->toBe([
                'product_id' => $this->icedTea->id,
                'name' => 'Iced Tea',
                'sku' => 'DRK-001',
                'category' => ['id' => $this->drinks->id, 'name' => 'Drinks'],
                'image_url' => null,
                'is_available' => true,
                'qty' => 9,
                'reorder_level' => 10,
                'status' => 'low',
                'cost_cents' => 1200,
                'stock_value_cents' => 10800,
                'last_movement_at' => '2026-09-27T05:10:00Z',
            ])
            ->and($response->json('data'))->toBe(collect(listInventory($this->manager)->json('data'))->firstWhere('product_id', $this->icedTea->id));

        showInventoryItem($this->manager, $this->soda)
            ->assertOk()
            ->assertJsonPath('data.qty', 0)
            ->assertJsonPath('data.status', 'out')
            ->assertJsonPath('data.last_movement_at', null);

        showInventoryItem($this->manager, $this->chips)->assertOk()->assertJsonPath('data.is_available', false);
    });

    it('shows the caller\'s branch qty and reorder level', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        stockUp($this->icedTea, 4, $north);
        setReorderLevel($this->icedTea, 3, $north);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();

        showInventoryItem($northManager, $this->icedTea)
            ->assertOk()
            ->assertJsonPath('data.qty', 4)
            ->assertJsonPath('data.reorder_level', 3)
            ->assertJsonPath('data.status', 'in_stock')
            ->assertJsonPath('data.stock_value_cents', 4800);

        showInventoryItem($northManager, $this->water)
            ->assertOk()
            ->assertJsonPath('data.qty', 0)
            ->assertJsonPath('data.reorder_level', null)
            ->assertJsonPath('data.last_movement_at', null);
    });

    it('returns 409 for a product that does not track stock', function () {
        showInventoryItem($this->manager, $this->hotDog)
            ->assertConflict()
            ->assertExactJson(['message' => "This product doesn't track stock."]);
    });

    it('returns 404 for an unknown or deleted product', function () {
        showInventoryItem($this->manager, 999999)->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        showInventoryItem($this->manager, $this->gone->id)->assertNotFound();
    });

    it('is open to inventory.adjust or report.view, and 403 otherwise', function () {
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);
        $clerk = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('clerk', ['inventory.adjust'])->id]);
        $menu = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('menu-editor', ['product.manage'])->id]);

        showInventoryItem($viewer, $this->icedTea)->assertOk();
        showInventoryItem($clerk, $this->icedTea)->assertOk();
        showInventoryItem($menu, $this->icedTea)->assertForbidden();
        showInventoryItem(userWithRole('cashier'), $this->icedTea)
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
        // 403 comes before the 409.
        showInventoryItem(userWithRole('cashier'), $this->hotDog)->assertForbidden();
    });

    it('returns 401 without a token', function () {
        $this->getJson("/api/v1/inventory/{$this->icedTea->id}")
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});
