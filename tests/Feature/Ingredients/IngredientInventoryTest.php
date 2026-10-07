<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\IdempotencyKey;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-28 02:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->cashier = userWithRole('cashier');
    $this->flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
});

afterEach(function () {
    Carbon::setTestNow();
});

function adjustIngredient(User $user, int $ingredientId, array $body, ?string $key = null): TestResponse
{
    return test()->withToken(tokenFor($user))->postJson(
        "/api/v1/admin/ingredients/{$ingredientId}/stock-adjustments",
        $body,
        ['Idempotency-Key' => $key ?? ($body['ulid'] ?? '')],
    );
}

function ingredientAdjustment(array $overrides = []): array
{
    return ['ulid' => newUlid(), 'type' => 'adjustment', 'qty' => '1', 'unit' => 'kg', 'reason' => 'Recount', ...$overrides];
}

describe('weighted average (worked example H)', function () {
    it('moves the average on receipts only and values consumption at it', function () {
        // 1. 5000 g on hand at 4.000000.
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        expect((string) ingredientLevel($this->flour)->avg_cost)->toBe('4.000000');

        // 2-3. One sack @ ₱1,200.00: avg 4.666667, qty 30000.000, value ₱1,400.00.
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '25000', 120000);
        $level = ingredientLevel($this->flour);
        expect((string) $level->avg_cost)->toBe('4.666667')
            ->and((string) $level->qty)->toBe('30000.000');

        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/inventory/ingredients/{$this->flour->id}")
            ->assertOk()
            ->assertJsonPath('data.stock_value_cents', 140000)
            ->assertJsonPath('data.avg_cost', '4.666667');

        // 4. 240 g used: value −1120, average unchanged.
        $sale = ingredientMovement($this->flour, StockMovement::TYPE_SALE, '-240');
        expect($sale->value_cents)->toBe(-1120)
            ->and((string) ingredientLevel($this->flour)->avg_cost)->toBe('4.666667');

        expectIngredientLedgerConsistent($this->flour);
    });

    it('keeps the average across adjustments and a correction, and the ledger consistent', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '25000', 120000);

        // A positive adjustment is valued at the average; the average doesn't move.
        adjustIngredient($this->manager, $this->flour->id, ingredientAdjustment(['qty' => '1', 'unit' => 'kg']))
            ->assertCreated()
            ->assertJsonPath('data.value_cents', 4667)
            ->assertJsonPath('data.qty_after', '31000.000');
        expect((string) ingredientLevel($this->flour)->avg_cost)->toBe('4.666667');

        // A correction (negative receipt of 5000 g costing 24000) reverses the receipt formula.
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '-5000', -24000);
        // (31000 × 4.666667 − 24000) / 26000 = 4.641026…
        expect((string) ingredientLevel($this->flour)->avg_cost)->toBe('4.641026');

        adjustIngredient($this->manager, $this->flour->id, ingredientAdjustment(['type' => 'wastage', 'qty' => '-2', 'unit' => 'cup']))
            ->assertCreated()
            ->assertJsonPath('data.qty_delta', '-240.000')
            ->assertJsonPath('data.value_cents', -1114);

        expectIngredientLedgerConsistent($this->flour);
        expectReconciled();
    });

    it('leaves the average unchanged when a receipt of a negative stock nets to zero or below', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '1000', 4000);
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '-1000', -4000);

        expect((string) ingredientLevel($this->flour)->avg_cost)->toBe('4.000000')
            ->and((string) ingredientLevel($this->flour)->qty)->toBe('0.000');
    });
});

describe('POST /admin/ingredients/{id}/stock-adjustments', function () {
    beforeEach(function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
    });

    it('records an adjustment (201) with the movement, before and after, and the audit entry', function () {
        $body = ingredientAdjustment(['qty' => '-0.5', 'unit' => 'kg']);

        adjustIngredient($this->manager, $this->flour->id, $body)->assertCreated()->assertExactJson(['data' => [
            'ulid' => $body['ulid'],
            'ingredient_id' => $this->flour->id,
            'type' => 'adjustment',
            'qty_delta' => '-500.000',
            'qty_before' => '5000.000',
            'qty_after' => '4500.000',
            'entered_qty' => '-0.500',
            'entered_unit' => 'kg',
            'unit_cost_cents' => null,
            'value_cents' => -2000,
            'reason' => 'Recount',
            'occurred_at' => '2026-09-28T02:00:00Z',
            'created_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
            'reference' => null,
        ]]);

        expect(ksortDeep(lastAudit('stock.adjusted')->changes))->toBe([
            'entered_qty' => '-0.500', 'entered_unit' => 'kg',
            'qty' => ['from' => '5000.000', 'to' => '4500.000'], 'reason' => 'Recount', 'type' => 'adjustment',
        ]);
    });

    it('works out a count\'s change', function () {
        adjustIngredient($this->manager, $this->flour->id, ingredientAdjustment(['type' => 'count', 'qty' => '4.8', 'unit' => 'kg']))
            ->assertCreated()
            ->assertJsonPath('data.type', 'count')
            ->assertJsonPath('data.qty_delta', '-200.000')
            ->assertJsonPath('data.qty_after', '4800.000');

        adjustIngredient($this->manager, $this->flour->id, ingredientAdjustment(['type' => 'count', 'qty' => '4800', 'unit' => 'g']))
            ->assertUnprocessable()
            ->assertJsonPath('errors.qty', ['Stock is already 4800.000 g.']);
    });

    it('refuses to go below zero, a positive wastage, a receipt and an unknown unit', function () {
        $manager = $this->manager;

        adjustIngredient($manager, $this->flour->id, ingredientAdjustment(['qty' => '-6', 'unit' => 'kg']))
            ->assertUnprocessable()->assertJsonPath('errors.qty', ["Stock can't go below zero (5000.000 g on hand)."]);
        adjustIngredient($manager, $this->flour->id, ingredientAdjustment(['type' => 'wastage', 'qty' => '1']))
            ->assertUnprocessable()->assertJsonPath('errors.qty', ['Wastage must remove stock.']);
        adjustIngredient($manager, $this->flour->id, ingredientAdjustment(['type' => 'receipt']))
            ->assertUnprocessable()->assertJsonValidationErrors(['type']);
        adjustIngredient($manager, $this->flour->id, ingredientAdjustment(['unit' => 'tbsp']))
            ->assertUnprocessable()->assertJsonPath('errors.unit', ['Add "tbsp" to Flour\'s units first.']);
        adjustIngredient($manager, $this->flour->id, ingredientAdjustment(['qty' => '1.2345']))
            ->assertUnprocessable()->assertJsonValidationErrors(['qty']);
        adjustIngredient($manager, $this->flour->id, ['ulid' => newUlid()])
            ->assertUnprocessable()->assertJsonValidationErrors(['qty', 'unit', 'reason']);
        adjustIngredient($manager, $this->flour->id, ingredientAdjustment(), 'not-a-ulid')
            ->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key']);
    });

    it('replays by ulid without writing twice', function () {
        $body = ingredientAdjustment(['qty' => '1', 'unit' => 'kg']);

        $first = adjustIngredient($this->manager, $this->flour->id, $body)->assertCreated()->json();
        $second = adjustIngredient($this->manager, $this->flour->id, $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true')->json();

        expect($second)->toBe($first)
            ->and(StockMovement::query()->where('ulid', $body['ulid'])->count())->toBe(1);

        // With the key released (e.g. expired), the ledger still recognises the ULID.
        IdempotencyKey::query()->delete();
        adjustIngredient($this->manager, $this->flour->id, $body)->assertCreated()->assertJsonPath('data.qty_after', '6000.000');
        expect((string) ingredientLevel($this->flour)->qty)->toBe('6000.000');
    });

    it('needs inventory.adjust (401, 403)', function () {
        $this->postJson("/api/v1/admin/ingredients/{$this->flour->id}/stock-adjustments", ingredientAdjustment())->assertUnauthorized();
        adjustIngredient($this->cashier, $this->flour->id, ingredientAdjustment())->assertForbidden();
        adjustIngredient($this->manager, 999999, ingredientAdjustment())->assertNotFound();
    });
});

describe('ingredient inventory reads', function () {
    it('lists every ingredient with the branch summary and filters by status', function () {
        $milk = makeIngredient('Milk', 'mL');
        $egg = makeIngredient('Egg', 'pc');
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        ingredientMovement($egg, StockMovement::TYPE_RECEIPT, '10', 8000);
        $this->withToken(tokenFor($this->manager))->putJson("/api/v1/inventory/ingredients/{$egg->id}/reorder-level", [
            'reorder_level' => ['qty' => '1', 'unit' => 'dozen'],
        ])->assertOk()->assertJsonPath('data.reorder_level', '12.000')->assertJsonPath('data.status', 'low');

        $token = tokenFor($this->manager);
        $response = $this->withToken($token)->getJson('/api/v1/inventory/ingredients')->assertOk();

        expect(collect($response->json('data'))->pluck('status', 'name')->all())->toBe(['Egg' => 'low', 'Flour' => 'in_stock', 'Milk' => 'out'])
            ->and($response->json('meta.summary'))->toBe(['tracked' => 3, 'low' => 1, 'out' => 1])
            ->and(array_keys($response->json('data.0')))->toBe(ingredientKeys());

        expect(collect($this->withToken($token)->getJson('/api/v1/inventory/ingredients?status=alerts')->json('data'))->pluck('name')->all())->toBe(['Egg', 'Milk']);
    });

    it('shows the movements newest first with the running balance and the receipt reference', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000, occurredAt: '2026-09-27 01:00:00');
        adjustIngredient($this->manager, $this->flour->id, ingredientAdjustment(['type' => 'wastage', 'qty' => '-1', 'unit' => 'cup']))->assertCreated();

        $items = $this->withToken(tokenFor($this->manager))->getJson("/api/v1/inventory/ingredients/{$this->flour->id}/movements")
            ->assertOk()->json('data');

        expect(array_keys($items[0]))->toBe([
            'ulid', 'type', 'qty_delta', 'qty_after', 'entered_qty', 'entered_unit', 'unit_cost_cents', 'value_cents',
            'reason', 'occurred_at', 'created_by', 'reference',
        ])
            ->and(collect($items)->map(fn ($m) => [$m['type'], $m['qty_delta'], $m['qty_after'], $m['entered_qty'], $m['entered_unit'], $m['value_cents']])->all())
            ->toBe([
                ['wastage', '-120.000', '4880.000', '-1.000', 'cup', -480],
                ['receipt', '5000.000', '5000.000', null, null, 20000],
            ]);
    });

    it('needs inventory.adjust or report.view, and 404s an unknown ingredient', function () {
        $this->getJson('/api/v1/inventory/ingredients')->assertUnauthorized();
        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/inventory/ingredients')->assertForbidden();
        $this->withToken(tokenFor($this->cashier))->putJson("/api/v1/inventory/ingredients/{$this->flour->id}/reorder-level", ['reorder_level' => null])->assertForbidden();

        $reader = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('reader', ['report.view'])->id]);
        $this->withToken(tokenFor($reader))->getJson("/api/v1/inventory/ingredients/{$this->flour->id}")->assertOk();
        $this->withToken(tokenFor($reader))->putJson("/api/v1/inventory/ingredients/{$this->flour->id}/reorder-level", ['reorder_level' => null])->assertForbidden();

        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/inventory/ingredients/999999')->assertNotFound();
    });

    it('sets, validates and clears the reorder level, auditing changes only', function () {
        $token = tokenFor($this->manager);
        $url = "/api/v1/inventory/ingredients/{$this->flour->id}/reorder-level";

        $this->withToken($token)->putJson($url, ['reorder_level' => ['qty' => '2', 'unit' => 'kg']])->assertOk()->assertJsonPath('data.reorder_level', '2000.000');
        $this->withToken($token)->putJson($url, ['reorder_level' => ['qty' => '2000', 'unit' => 'g']])->assertOk();
        expect(AuditLog::query()->where('action', 'stock.reorder_level_changed')->count())->toBe(1);

        $this->withToken($token)->putJson($url, ['reorder_level' => ['qty' => '1', 'unit' => 'tbsp']])
            ->assertUnprocessable()->assertJsonPath('errors', ['reorder_level.unit' => ['Add "tbsp" to Flour\'s units first.']]);
        $this->withToken($token)->putJson($url, [])->assertUnprocessable()->assertJsonValidationErrors(['reorder_level']);

        $this->withToken($token)->putJson($url, ['reorder_level' => null])->assertOk()->assertJsonPath('data.reorder_level', null);
        expect(ksortDeep(lastAudit('stock.reorder_level_changed')->changes))->toBe(['reorder_level' => ['from' => '2000.000', 'to' => null]]);
    });

    it('keeps each branch\'s stock apart', function () {
        $other = Branch::factory()->create(['code' => 'NORTH']);
        $northManager = User::factory()->forBranch($other)->withRole('manager')->create();
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);

        $this->withToken(tokenFor($northManager))->getJson("/api/v1/inventory/ingredients/{$this->flour->id}")
            ->assertOk()->assertJsonPath('data.qty', '0.000')->assertJsonPath('data.status', 'out');
    });
});

describe('GET /reports/inventory?kind=ingredients', function () {
    it('reports the flows, values and the invariant, and exports the CSV', function () {
        $milk = makeIngredient('Milk', 'mL');
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000, occurredAt: '2026-09-26 01:00:00');
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '25000', 120000, occurredAt: '2026-09-27 01:00:00');
        ingredientMovement($this->flour, StockMovement::TYPE_SALE, '-240', occurredAt: '2026-09-27 02:00:00');
        ingredientMovement($this->flour, StockMovement::TYPE_WASTAGE, '-100', occurredAt: '2026-09-27 03:00:00');
        ingredientMovement($this->flour, StockMovement::TYPE_VOID, '40', occurredAt: '2026-09-27 04:00:00');
        ingredientMovement($this->flour, StockMovement::TYPE_COUNT, '-50', occurredAt: '2026-09-27 05:00:00');

        $response = $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/reports/inventory?kind=ingredients&from=2026-09-27&to=2026-09-27&category_id=5')
            ->assertOk()
            ->assertJsonPath('meta.truncated', false);

        $flour = collect($response->json('data.rows'))->firstWhere('name', 'Flour');

        expect(array_keys($flour))->toBe([
            'ingredient_id', 'name', 'base_unit', 'opening_qty', 'received', 'used', 'returned', 'wasted', 'adjusted',
            'closing_qty', 'reorder_level', 'status', 'avg_cost', 'stock_value_cents', 'value_in_cents', 'value_out_cents',
        ])
            ->and($flour)->toMatchArray([
                'opening_qty' => '5000.000', 'received' => '25000.000', 'used' => '240.000', 'returned' => '40.000',
                'wasted' => '100.000', 'adjusted' => '-50.000', 'closing_qty' => '29650.000', 'avg_cost' => '4.666667',
                'value_in_cents' => 120000 + 187, 'value_out_cents' => 1120 + 467 + 233,
            ])
            ->and($flour['closing_qty'])->toBe((string) ingredientLevel($this->flour)->qty)
            ->and(array_keys($response->json('data.totals')))->toBe(['tracked', 'low', 'out', 'stock_value_cents', 'value_in_cents', 'value_out_cents'])
            ->and($response->json('data.totals.value_in_cents'))->toBe($flour['value_in_cents']);

        $csv = $this->withToken(tokenFor($this->manager))
            ->get('/api/v1/reports/inventory/export?kind=ingredients&from=2026-09-27&to=2026-09-27')
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="inventory-ingredients-2026-09-27-2026-09-27.csv"')
            ->getContent();

        $lines = explode("\r\n", trim(substr($csv, 3)));
        expect($lines[0])->toBe('ingredient_id,name,base_unit,opening_qty,received,used,returned,wasted,adjusted,closing_qty,reorder_level,status,avg_cost_cents,stock_value,value_in,value_out')
            ->and(end($lines))->toStartWith('TOTAL,');
    });

    it('keeps the product report unchanged by default and rejects an unknown kind', function () {
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/reports/inventory?from=2026-09-27&to=2026-09-27')
            ->assertOk()->assertJsonPath('data.rows', []);
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/reports/inventory?kind=x&from=2026-09-27&to=2026-09-27')
            ->assertUnprocessable()->assertJsonValidationErrors(['kind']);
    });
});
