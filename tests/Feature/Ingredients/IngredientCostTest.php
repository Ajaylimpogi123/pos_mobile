<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\IdempotencyKey;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

/*
 * Ingredients, Recipes & Purchasing → D1: POST /api/v1/admin/ingredients/{id}/cost
 * (permission inventory.adjust, idempotent by ulid).
 */

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-29 04:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->cashier = userWithRole('cashier');
    $this->flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
});

afterEach(function () {
    Carbon::setTestNow();
});

function setIngredientCost(User $user, int $ingredientId, array $body, ?string $key = null): TestResponse
{
    return test()->withToken(tokenFor($user))->postJson(
        "/api/v1/admin/ingredients/{$ingredientId}/cost",
        $body,
        ['Idempotency-Key' => $key ?? ($body['ulid'] ?? '')],
    );
}

function ingredientCost(array $overrides = []): array
{
    return ['ulid' => newUlid(), 'cost_cents' => 125000, 'unit' => 'sack', 'reason' => 'Supplier price', ...$overrides];
}

function revaluations(): int
{
    return StockMovement::query()->where('type', StockMovement::TYPE_REVALUATION)->count();
}

describe('POST /admin/ingredients/{id}/cost', function () {
    it('sets the cost of worked example D1 (₱1,250 per sack → 5.000000, value +5000)', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        $body = ingredientCost();

        $response = setIngredientCost($this->manager, $this->flour->id, $body)
            ->assertOk()
            ->assertJsonPath('data.id', $this->flour->id)
            ->assertJsonPath('data.qty', '5000.000')
            ->assertJsonPath('data.avg_cost', '5.000000')
            ->assertJsonPath('data.stock_value_cents', 25000)
            ->assertJsonPath('data.status', 'in_stock')
            ->assertJsonPath('data.last_movement_at', '2026-09-29T04:00:00Z');

        expect(array_keys($response->json('data')))->toBe(ingredientKeys());

        $movement = StockMovement::query()->where('ulid', $body['ulid'])->firstOrFail();
        expect($movement->type)->toBe('revaluation')
            ->and((string) $movement->qty_delta)->toBe('0.000')
            ->and($movement->value_cents)->toBe(5000)
            ->and($movement->unit_cost_cents)->toBe(125000)
            ->and((string) $movement->entered_qty)->toBe('1.000')
            ->and($movement->entered_unit)->toBe('sack')
            ->and($movement->reason)->toBe('Supplier price')
            ->and($movement->branch_id)->toBe($this->branch->id)
            ->and($movement->created_by)->toBe($this->manager->id);

        $level = ingredientLevel($this->flour);
        expect((string) $level->avg_cost)->toBe('5.000000')
            ->and((string) $level->qty)->toBe('5000.000');

        expect(ksortDeep(lastAudit('ingredient.cost_set')->changes))->toBe([
            'avg_cost' => ['from' => '4.000000', 'to' => '5.000000'],
            'cost_cents' => 125000,
            'unit' => 'sack',
        ]);

        expectIngredientLedgerConsistent($this->flour);
        expectReconciled();
    });

    it('sets a cost per base unit, matching the unit case-insensitively, without a reason', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);

        setIngredientCost($this->manager, $this->flour->id, ingredientCost(['cost_cents' => 48, 'unit' => 'G', 'reason' => null]))
            ->assertOk()
            ->assertJsonPath('data.avg_cost', '48.000000')
            ->assertJsonPath('data.stock_value_cents', 240000);

        $movement = StockMovement::query()->where('type', 'revaluation')->firstOrFail();
        expect($movement->value_cents)->toBe(220000)
            ->and($movement->entered_unit)->toBe('g')
            ->and($movement->reason)->toBeNull();

        // A price that isn't a whole centavo per base unit keeps 6 decimals: ₱1.00 per sack.
        setIngredientCost($this->manager, $this->flour->id, ingredientCost(['cost_cents' => 100, 'unit' => 'sack']))
            ->assertOk()
            ->assertJsonPath('data.avg_cost', '0.004000')
            ->assertJsonPath('data.stock_value_cents', 20);

        expectIngredientLedgerConsistent($this->flour);
    });

    it('sets the average with no stock: the level is created and the value change is 0', function () {
        expect(ingredientLevel($this->flour))->toBeNull();

        setIngredientCost($this->manager, $this->flour->id, ingredientCost())
            ->assertOk()
            ->assertJsonPath('data.qty', '0.000')
            ->assertJsonPath('data.avg_cost', '5.000000')
            ->assertJsonPath('data.stock_value_cents', 0);

        expect((string) ingredientLevel($this->flour)->avg_cost)->toBe('5.000000')
            ->and(StockMovement::query()->where('type', 'revaluation')->sole()->value_cents)->toBe(0);

        // A later positive adjustment is valued at the new average.
        test()->withToken(tokenFor($this->manager))->postJson(
            "/api/v1/admin/ingredients/{$this->flour->id}/stock-adjustments",
            $body = ['ulid' => newUlid(), 'qty' => '2', 'unit' => 'kg', 'reason' => 'Opening'],
            ['Idempotency-Key' => $body['ulid']],
        )->assertCreated()->assertJsonPath('data.value_cents', 10000);

        expectIngredientLedgerConsistent($this->flour);
    });

    it('sets the average of a negative stock with a value change of 0', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '1000', 4000);
        ingredientMovement($this->flour, StockMovement::TYPE_SALE, '-3000');

        setIngredientCost($this->manager, $this->flour->id, ingredientCost())
            ->assertOk()
            ->assertJsonPath('data.qty', '-2000.000')
            ->assertJsonPath('data.avg_cost', '5.000000')
            ->assertJsonPath('data.stock_value_cents', 0)
            ->assertJsonPath('data.status', 'out');

        expect(StockMovement::query()->where('type', 'revaluation')->sole()->value_cents)->toBe(0)
            ->and((string) ingredientLevel($this->flour)->qty)->toBe('-2000.000');
    });

    it('writes nothing when the average doesn\'t change, and still returns 200', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        $movements = StockMovement::query()->count();

        // ₱1,000 per sack = 4.000000, the current average.
        setIngredientCost($this->manager, $this->flour->id, ingredientCost(['cost_cents' => 100000]))
            ->assertOk()
            ->assertJsonPath('data.avg_cost', '4.000000')
            ->assertJsonPath('data.stock_value_cents', 20000);

        expect(StockMovement::query()->count())->toBe($movements)
            ->and(AuditLog::query()->where('action', 'ingredient.cost_set')->count())->toBe(0);
    });

    it('rejects an unknown unit, a cost too small for its unit, and invalid fields', function () {
        $manager = $this->manager;
        $id = $this->flour->id;

        setIngredientCost($manager, $id, ingredientCost(['unit' => 'tbsp']))
            ->assertUnprocessable()->assertJsonPath('errors', ['unit' => ['Add "tbsp" to Flour\'s units first.']]);

        // Only reachable with a unit above 2,000,000 base units (the units editor caps factors at
        // 1,000,000), so the unit is written directly.
        $salt = makeIngredient('Salt', 'g', ['container' => '3000000']);
        setIngredientCost($manager, $salt->id, ingredientCost(['cost_cents' => 1, 'unit' => 'container']))
            ->assertUnprocessable()->assertJsonPath('errors', ['cost_cents' => ['The cost is too small for this unit.']]);
        setIngredientCost($manager, $salt->id, ingredientCost(['cost_cents' => 2, 'unit' => 'container']))
            ->assertOk()->assertJsonPath('data.avg_cost', '0.000001');

        setIngredientCost($manager, $id, ['ulid' => newUlid()])
            ->assertUnprocessable()->assertJsonValidationErrors(['cost_cents', 'unit'])->assertJsonMissingValidationErrors(['reason']);
        setIngredientCost($manager, $id, ingredientCost(['cost_cents' => 0]))
            ->assertUnprocessable()->assertJsonValidationErrors(['cost_cents']);
        setIngredientCost($manager, $id, ingredientCost(['cost_cents' => 100000001]))
            ->assertUnprocessable()->assertJsonValidationErrors(['cost_cents']);
        setIngredientCost($manager, $id, ingredientCost(['cost_cents' => 12.5]))
            ->assertUnprocessable()->assertJsonValidationErrors(['cost_cents']);
        setIngredientCost($manager, $id, ingredientCost(['reason' => str_repeat('x', 256)]))
            ->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        setIngredientCost($manager, $id, ingredientCost(['ulid' => 'nope']), newUlid())
            ->assertUnprocessable()->assertJsonValidationErrors(['ulid']);
        setIngredientCost($manager, $id, ingredientCost(), 'not-a-ulid')
            ->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key']);

        expect(revaluations())->toBe(1);
    });

    it('needs inventory.adjust (401, 403) and a non-deleted ingredient (404)', function () {
        $this->postJson("/api/v1/admin/ingredients/{$this->flour->id}/cost", ingredientCost())->assertUnauthorized();
        setIngredientCost($this->cashier, $this->flour->id, ingredientCost())
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);

        $reader = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('reader', ['report.view', 'product.manage'])->id]);
        setIngredientCost($reader, $this->flour->id, ingredientCost())->assertForbidden();

        setIngredientCost($this->manager, 999999, ingredientCost())
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);

        $this->flour->delete();
        setIngredientCost($this->manager, $this->flour->id, ingredientCost())->assertNotFound();

        expect(revaluations())->toBe(0);
    });

    it('changes only the caller\'s branch', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '1000', 4000, branch: $north);
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);

        setIngredientCost($this->manager, $this->flour->id, ingredientCost())->assertOk()->assertJsonPath('data.avg_cost', '5.000000');

        expect((string) ingredientLevel($this->flour, $north)->avg_cost)->toBe('4.000000')
            ->and(StockMovement::query()->where('branch_id', $north->id)->where('type', 'revaluation')->exists())->toBeFalse();

        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();
        $this->withToken(tokenFor($northManager))->getJson("/api/v1/admin/ingredients/{$this->flour->id}")
            ->assertOk()->assertJsonPath('data.avg_cost', '4.000000')->assertJsonPath('data.stock_value_cents', 4000);
    });

    it('replays by ulid without writing twice, and refuses a ulid of another movement', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        $body = ingredientCost();

        $first = setIngredientCost($this->manager, $this->flour->id, $body)->assertOk()->json();
        $second = setIngredientCost($this->manager, $this->flour->id, $body)
            ->assertOk()->assertHeader('Idempotency-Replayed', 'true')->json();

        expect($second)->toBe($first)
            ->and(revaluations())->toBe(1)
            ->and(AuditLog::query()->where('action', 'ingredient.cost_set')->count())->toBe(1);

        // With the key released (e.g. expired), the ledger still recognises the ULID.
        IdempotencyKey::query()->delete();
        setIngredientCost($this->manager, $this->flour->id, $body)->assertOk()->assertJsonPath('data.avg_cost', '5.000000');
        expect(revaluations())->toBe(1);

        // The same key with another body is a 409 (the middleware), and so is the ULID of another
        // movement once its key is gone (the ledger).
        setIngredientCost($this->manager, $this->flour->id, [...$body, 'cost_cents' => 150000])
            ->assertStatus(409)->assertJsonPath('message', 'This Idempotency-Key was already used for a different request.');

        $receipt = StockMovement::query()->where('type', 'receipt')->firstOrFail();
        setIngredientCost($this->manager, $this->flour->id, ingredientCost(['ulid' => $receipt->ulid]))
            ->assertStatus(409)->assertJsonPath('message', 'This Idempotency-Key was already used for a different request.');
    });
});

describe('set cost and the rest of the ledger', function () {
    it('costs recipes at the new average', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        $pancake = Product::factory()->forCategory(Category::factory()->create())->stockMode(Product::STOCK_RECIPE)
            ->create(['name' => 'Pancake', 'price_cents' => 12000, 'cost_cents' => 0]);
        $url = "/api/v1/admin/products/{$pancake->id}/recipe";
        $token = tokenFor($this->manager);

        $this->withToken($token)->putJson($url, ['lines' => [
            ['component_type' => 'ingredient', 'component_id' => $this->flour->id, 'qty' => '1', 'unit' => 'cup'],
        ]])->assertOk()->assertJsonPath('data.cost_cents', 480);

        setIngredientCost($this->manager, $this->flour->id, ingredientCost())->assertOk();

        $this->withToken($token)->getJson($url)
            ->assertOk()
            ->assertJsonPath('data.lines.0.unit_cost', '5.000000')
            ->assertJsonPath('data.lines.0.line_cost_cents', 600)
            ->assertJsonPath('data.cost_cents', 600);
    });

    it('lets a following receipt re-weight from the new average', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        setIngredientCost($this->manager, $this->flour->id, ingredientCost())->assertOk();

        $po = approvedPurchaseOrder($this->manager, $this->owner, [
            prItem($this->flour, makeSupplier(), '1', 'sack', ['estimated_unit_price_cents' => 120000]),
        ]);
        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $po['lines'][0]['id'], 'qty' => '1', 'unit' => 'sack']])->assertCreated();

        // (5000 × 5 + 120000) / 30000 = 4.833333…
        $level = ingredientLevel($this->flour);
        expect((string) $level->avg_cost)->toBe('4.833333')
            ->and((string) $level->qty)->toBe('30000.000');

        expectIngredientLedgerConsistent($this->flour);
    });

    it('shows the revaluation in the history and filters by it', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000, occurredAt: '2026-09-28 04:00:00');
        $body = ingredientCost();
        setIngredientCost($this->manager, $this->flour->id, $body)->assertOk();

        $url = "/api/v1/inventory/ingredients/{$this->flour->id}/movements";
        $token = tokenFor($this->manager);
        $revaluation = [
            'ulid' => $body['ulid'],
            'type' => 'revaluation',
            'qty_delta' => '0.000',
            'qty_after' => '5000.000',
            'entered_qty' => '1.000',
            'entered_unit' => 'sack',
            'unit_cost_cents' => 125000,
            'value_cents' => 5000,
            'reason' => 'Supplier price',
            'occurred_at' => '2026-09-29T04:00:00Z',
            'created_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
            'reference' => null,
        ];

        $items = $this->withToken($token)->getJson($url)->assertOk()->json('data');
        expect($items[0])->toBe($revaluation)
            ->and(collect($items)->pluck('type')->all())->toBe(['revaluation', 'receipt']);

        $this->withToken($token)->getJson("{$url}?type=revaluation")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0', $revaluation)
            ->assertJsonStructure(['data', 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor']]);
    });

    it('isn\'t a type of product stock adjustments', function () {
        $water = Product::factory()->forCategory(Category::factory()->create())->create(['track_stock' => true]);
        $body = ['ulid' => newUlid(), 'type' => 'revaluation', 'qty_delta' => 1, 'reason' => 'x'];

        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/products/{$water->id}/stock-adjustments", $body, ['Idempotency-Key' => $body['ulid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['type']);

        // Nor of ingredient stock adjustments.
        $body = ['ulid' => newUlid(), 'type' => 'revaluation', 'qty' => '1', 'unit' => 'g', 'reason' => 'x'];
        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/ingredients/{$this->flour->id}/stock-adjustments", $body, ['Idempotency-Key' => $body['ulid']])
            ->assertUnprocessable()->assertJsonValidationErrors(['type']);
    });

    it('puts the revaluation value into the inventory report, which still reconciles', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000, occurredAt: '2026-09-28 04:00:00');
        setIngredientCost($this->manager, $this->flour->id, ingredientCost())->assertOk();              // +5000
        ingredientMovement($this->flour, StockMovement::TYPE_SALE, '-240');                            // −1200
        setIngredientCost($this->manager, $this->flour->id, ingredientCost(['cost_cents' => 100000])) // 4.000000: −4760
            ->assertOk();

        $flour = collect($this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/reports/inventory?kind=ingredients&from=2026-09-28&to=2026-09-29')
            ->assertOk()
            ->json('data.rows'))->firstWhere('name', 'Flour');

        expect($flour)->toMatchArray([
            'opening_qty' => '0.000', 'received' => '5000.000', 'used' => '240.000', 'returned' => '0.000',
            'wasted' => '0.000', 'adjusted' => '0.000', 'closing_qty' => '4760.000',
            'avg_cost' => '4.000000', 'stock_value_cents' => 19040,
            'value_in_cents' => 20000 + 5000, 'value_out_cents' => 1200 + 4760,
        ])
            // The quantity invariant, and the value invariant: in − out = the stock value.
            ->and($flour['closing_qty'])->toBe((string) ingredientLevel($this->flour)->qty)
            ->and($flour['value_in_cents'] - $flour['value_out_cents'])->toBe($flour['stock_value_cents']);

        expectIngredientLedgerConsistent($this->flour);
    });
});
