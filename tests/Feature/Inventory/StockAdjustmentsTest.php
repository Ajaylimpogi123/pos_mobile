<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\IdempotencyKey;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-25 02:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);
    $this->icedTea = Product::factory()->forCategory($this->drinks)->create([
        'name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true,
    ]);
    stockUp($this->icedTea, 26);
});

afterEach(function () {
    Carbon::setTestNow();
});

function adjustStock(User $user, Product|int $product, array $body, ?string $key = null): TestResponse
{
    $id = $product instanceof Product ? $product->id : $product;

    return test()->withToken(tokenFor($user))->postJson(
        "/api/v1/admin/products/{$id}/stock-adjustments",
        $body,
        ['Idempotency-Key' => $key ?? ($body['ulid'] ?? '')],
    );
}

function adjustment(array $overrides = []): array
{
    return ['ulid' => newUlid(), 'reason' => 'Delivery from supplier', ...$overrides];
}

describe('success', function () {
    it('adds a delta and returns 201 with the adjustment', function () {
        $body = adjustment(['qty_delta' => 24]);

        $response = adjustStock($this->manager, $this->icedTea, $body)->assertCreated();

        $response->assertExactJson(['data' => [
            'ulid' => $body['ulid'],
            'product_id' => $this->icedTea->id,
            'type' => 'adjustment',
            'qty_delta' => 24,
            'qty_before' => 26,
            'qty_after' => 50,
            'reason' => 'Delivery from supplier',
            'occurred_at' => '2026-09-25T02:00:00Z',
            'created_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
        ]]);

        $movement = StockMovement::query()->where('type', 'adjustment')->sole();
        expect($movement->ulid)->toBe($body['ulid'])
            ->and($movement->branch_id)->toBe($this->branch->id)
            ->and($movement->wholeQtyDelta())->toBe(24)
            ->and($movement->unit_cost_cents)->toBe(1575)
            ->and($movement->reason)->toBe('Delivery from supplier')
            ->and($movement->created_by)->toBe($this->manager->id)
            ->and(stockOf($this->icedTea))->toBe(50)
            ->and((int) StockMovement::query()->where('product_id', $this->icedTea->id)->sum('qty_delta'))->toBe(50);

        $audit = AuditLog::query()->where('action', 'stock.adjusted')->sole();
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_type)->toBe($this->icedTea->getMorphClass())
            ->and($audit->subject_id)->toBe($this->icedTea->id)
            ->and(ksortDeep($audit->changes))->toBe(['qty' => ['from' => 26, 'to' => 50], 'reason' => 'Delivery from supplier', 'type' => 'adjustment']);
    });

    it('removes stock, down to exactly zero', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['qty_delta' => -26, 'reason' => 'Spoiled']))
            ->assertCreated()
            ->assertJsonPath('data.qty_delta', -26)
            ->assertJsonPath('data.qty_after', 0);

        expect(stockOf($this->icedTea))->toBe(0);
    });

    it('sets a counted quantity, working out the delta', function (int $count, int $delta) {
        adjustStock($this->manager, $this->icedTea, adjustment(['counted_qty' => $count, 'reason' => 'Stock count']))
            ->assertCreated()
            ->assertJsonPath('data.qty_delta', $delta)
            ->assertJsonPath('data.qty_before', 26)
            ->assertJsonPath('data.qty_after', $count);

        expect(stockOf($this->icedTea))->toBe($count)
            ->and(ksortDeep(AuditLog::query()->where('action', 'stock.adjusted')->sole()->changes))
            ->toBe(['qty' => ['from' => 26, 'to' => $count], 'reason' => 'Stock count', 'type' => 'adjustment']);
    })->with([
        'more' => [40, 14],
        'less' => [20, -6],
        'none left' => [0, -26],
    ]);

    it('stocks a product for the first time from 0', function () {
        $water = Product::factory()->forCategory($this->drinks)->create(['track_stock' => true]);

        adjustStock($this->manager, $water, adjustment(['counted_qty' => 30]))
            ->assertCreated()
            ->assertJsonPath('data.qty_before', 0)
            ->assertJsonPath('data.qty_after', 30);

        expect(StockLevel::query()->where('product_id', $water->id)->sole()->wholeQty())->toBe(30);
    });

    it('needs inventory.adjust, not product.manage', function () {
        $clerk = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('stock-clerk', ['inventory.adjust'])->id]);

        adjustStock($clerk, $this->icedTea, adjustment(['qty_delta' => 1]))->assertCreated();
    });

    it('adjusts the caller\'s branch only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();

        adjustStock($northManager, $this->icedTea, adjustment(['qty_delta' => 5]))
            ->assertCreated()
            ->assertJsonPath('data.qty_before', 0)
            ->assertJsonPath('data.qty_after', 5);

        expect(stockOf($this->icedTea, $north))->toBe(5)
            ->and(stockOf($this->icedTea, $this->branch))->toBe(26)
            ->and(StockMovement::query()->where('type', 'adjustment')->sole()->branch_id)->toBe($north->id);

        adjustStock($northManager, $this->icedTea, adjustment(['qty_delta' => -6]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['qty_delta' => "Stock can't go below zero (5 on hand)."]);
    });

    it('replays the stored response for the same key and body', function () {
        $body = adjustment(['qty_delta' => 4]);

        $first = adjustStock($this->manager, $this->icedTea, $body)->assertCreated();
        $replay = adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->getContent())->toBe($first->getContent())
            ->and(StockMovement::query()->where('type', 'adjustment')->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(30);
    });

    it('rebuilds a committed adjustment from the ledger instead of adjusting twice', function () {
        $body = adjustment(['qty_delta' => 4]);
        $first = adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->json('data');
        adjustStock($this->manager, $this->icedTea, adjustment(['qty_delta' => 10]))->assertCreated();

        // As if the key had been released after the adjustment committed.
        IdempotencyKey::query()->delete();

        expect(adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->json('data'))->toBe($first)
            ->and(stockOf($this->icedTea))->toBe(40);
    });
});

describe('rules', function () {
    it('refuses to go below zero', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['qty_delta' => -27]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => "Stock can't go below zero (26 on hand).",
                'errors' => ['qty_delta' => ["Stock can't go below zero (26 on hand)."]],
            ]);

        expect(stockOf($this->icedTea))->toBe(26)
            ->and(StockMovement::query()->where('type', 'adjustment')->count())->toBe(0)
            ->and(AuditLog::query()->where('action', 'stock.adjusted')->count())->toBe(0);
    });

    it('refuses a count equal to the stock on hand', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['counted_qty' => 26]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'Stock is already 26.',
                'errors' => ['counted_qty' => ['Stock is already 26.']],
            ]);
    });

    it('returns 409 for a product that does not track stock', function () {
        $hotDog = Product::factory()->create(['track_stock' => false]);

        adjustStock($this->manager, $hotDog, adjustment(['qty_delta' => 5]))
            ->assertConflict()
            ->assertExactJson(['message' => "This product doesn't track stock."]);

        expect(StockLevel::query()->where('product_id', $hotDog->id)->exists())->toBeFalse();
    });

    it('validates fields before the 409', function () {
        $hotDog = Product::factory()->create(['track_stock' => false]);

        adjustStock($this->manager, $hotDog, adjustment(['qty_delta' => 0]))->assertUnprocessable();
    });
});

describe('validation (422)', function () {
    it('requires exactly one of qty_delta and counted_qty', function () {
        adjustStock($this->manager, $this->icedTea, adjustment())
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'qty_delta' => 'The qty delta field is required when counted qty is not present.',
                'counted_qty' => 'The counted qty field is required when qty delta is not present.',
            ]);

        adjustStock($this->manager, $this->icedTea, adjustment(['qty_delta' => 5, 'counted_qty' => 10]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['qty_delta' => 'The qty delta field prohibits counted qty from being present.']);

        adjustStock($this->manager, $this->icedTea, adjustment(['qty_delta' => null, 'counted_qty' => 10]))->assertCreated();
    });

    it('validates each field', function (array $body, string $field, string $message) {
        adjustStock($this->manager, $this->icedTea, adjustment($body))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);
    })->with([
        'zero delta' => [['qty_delta' => 0], 'qty_delta', 'The qty delta field must not be zero.'],
        'delta too big' => [['qty_delta' => 100001], 'qty_delta', 'The qty delta field must be between -100000 and 100000.'],
        'delta too small' => [['qty_delta' => -100001], 'qty_delta', 'The qty delta field must be between -100000 and 100000.'],
        'delta fraction' => [['qty_delta' => 1.5], 'qty_delta', 'The qty delta field must be an integer.'],
        'negative count' => [['counted_qty' => -1], 'counted_qty', 'The counted qty field must be between 0 and 100000.'],
        'count too big' => [['counted_qty' => 100001], 'counted_qty', 'The counted qty field must be between 0 and 100000.'],
        'no reason' => [['qty_delta' => 1, 'reason' => null], 'reason', 'The reason field is required.'],
        'reason too long' => [['qty_delta' => 1, 'reason' => str_repeat('r', 256)], 'reason', 'The reason field must not be greater than 255 characters.'],
        'bad ulid' => [['qty_delta' => 1, 'ulid' => 'not-a-ulid'], 'ulid', 'The ulid field format is invalid.'],
    ]);
});

describe('auth and 404', function () {
    it('returns 401 without a token', function () {
        $this->postJson("/api/v1/admin/products/{$this->icedTea->id}/stock-adjustments", adjustment(['qty_delta' => 1]))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 403 without inventory.adjust', function () {
        adjustStock(userWithRole('cashier'), $this->icedTea, adjustment(['qty_delta' => 1]))
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        $catalogueOnly = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('menu-editor', ['product.manage'])->id]);
        adjustStock($catalogueOnly, $this->icedTea, adjustment(['qty_delta' => 1]))->assertForbidden();

        expect(stockOf($this->icedTea))->toBe(26);
    });

    it('returns 404 for an unknown or soft-deleted product', function () {
        adjustStock($this->manager, 999999, adjustment(['qty_delta' => 1]))
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);

        $this->icedTea->delete();
        adjustStock($this->manager, $this->icedTea, adjustment(['qty_delta' => 1]))->assertNotFound();
    });
});

describe('admin Product.stock_qty', function () {
    it('shows the caller\'s branch quantity for tracked products, 0 if never stocked, null otherwise', function () {
        $water = Product::factory()->forCategory($this->drinks)->create(['name' => 'Bottled Water', 'track_stock' => true]);
        $juice = Product::factory()->forCategory($this->drinks)->create(['name' => 'Juice', 'track_stock' => false]);
        $north = Branch::factory()->create(['code' => 'NORTH']);
        stockUp($water, 7, $north);

        $stock = fn (User $user) => collect($this->withToken(tokenFor($user))->getJson('/api/v1/admin/products')->assertOk()->json('data'))
            ->pluck('stock_qty', 'name')
            ->all();

        expect($stock($this->manager))->toBe(['Bottled Water' => 0, 'Iced Tea' => 26, 'Juice' => null])
            ->and($stock(User::factory()->forBranch($north)->withRole('manager')->create()))
            ->toBe(['Bottled Water' => 7, 'Iced Tea' => 0, 'Juice' => null]);
    });

    it('is on every admin product endpoint', function () {
        $token = tokenFor($this->manager);
        $url = '/api/v1/admin/products/'.$this->icedTea->id;

        $this->withToken($token)->getJson($url)->assertOk()->assertJsonPath('data.stock_qty', 26);
        $this->withToken($token)->patchJson($url, ['name' => 'Iced Tea (L)'])->assertOk()->assertJsonPath('data.stock_qty', 26);
        // Round B (§J): leaving `own` needs the stock ≤ 0, so Iced Tea (26 on hand) can't stop tracking.
        $this->withToken($token)->patchJson($url, ['track_stock' => false])
            ->assertConflict()
            ->assertExactJson(['message' => 'Use up or write off the stock first.']);

        $water = Product::factory()->forCategory($this->drinks)->create(['name' => 'Bottled Water', 'track_stock' => true]);
        $waterUrl = '/api/v1/admin/products/'.$water->id;
        $this->withToken($token)->patchJson($waterUrl, ['track_stock' => false])->assertOk()->assertJsonPath('data.stock_qty', null);
        $this->withToken($token)->patchJson($waterUrl, ['track_stock' => true])->assertOk()->assertJsonPath('data.stock_qty', 0);

        $this->withToken($token)->postJson('/api/v1/admin/products', [
            'category_id' => $this->drinks->id, 'name' => 'Soda', 'price_cents' => 2500, 'track_stock' => true,
        ])->assertCreated()->assertJsonPath('data.stock_qty', 0);
    });

    it('is absent from the POS read endpoint and the catalogue sync', function () {
        $token = tokenFor(userWithRole('cashier'));

        $read = $this->withToken($token)->getJson('/api/v1/products')->assertOk();
        expect($read->json('data.0'))->not->toHaveKey('stock_qty')
            ->and(array_keys($read->json('data.0')))->toBe(productKeys(withCost: false));

        $sync = $this->withToken($token)->getJson('/api/v1/sync/catalogue')->assertOk();
        expect($sync->json('data.products.0'))->not->toHaveKey('stock_qty');
    });
});

describe('types (Inventory, v1 completion)', function () {
    it('records stock in as a receipt with the given unit cost, on the movement only', function () {
        $body = adjustment(['type' => 'receipt', 'qty_delta' => 24, 'unit_cost_cents' => 1200, 'reason' => 'Delivery']);

        adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->assertExactJson(['data' => [
            'ulid' => $body['ulid'],
            'product_id' => $this->icedTea->id,
            'type' => 'receipt',
            'qty_delta' => 24,
            'qty_before' => 26,
            'qty_after' => 50,
            'reason' => 'Delivery',
            'occurred_at' => '2026-09-25T02:00:00Z',
            'created_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
        ]]);

        $movement = StockMovement::query()->where('ulid', $body['ulid'])->sole();
        expect($movement->type)->toBe('receipt')
            ->and($movement->unit_cost_cents)->toBe(1200)
            ->and($this->icedTea->fresh()->cost_cents)->toBe(1575)
            ->and(stockOf($this->icedTea))->toBe(50)
            ->and(ksortDeep(lastAudit('stock.adjusted')->changes))
            ->toBe(['qty' => ['from' => 26, 'to' => 50], 'reason' => 'Delivery', 'type' => 'receipt']);
    });

    it('takes a receipt without a reason or a unit cost, at the product cost', function (array $extra) {
        $body = ['ulid' => newUlid(), 'type' => 'receipt', 'qty_delta' => 5, ...$extra];

        adjustStock($this->manager, $this->icedTea, $body)
            ->assertCreated()
            ->assertJsonPath('data.type', 'receipt')
            ->assertJsonPath('data.reason', null);

        expect(StockMovement::query()->where('ulid', $body['ulid'])->sole()->unit_cost_cents)->toBe(1575)
            ->and(lastAudit('stock.adjusted')->changes['reason'])->toBeNull();
    })->with([
        'omitted' => [[]],
        'nulls' => [['reason' => null, 'unit_cost_cents' => null]],
    ]);

    it('records a count typed count, with the delta worked out', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['type' => 'count', 'counted_qty' => 20, 'reason' => 'Weekly count']))
            ->assertCreated()
            ->assertJsonPath('data.type', 'count')
            ->assertJsonPath('data.qty_delta', -6)
            ->assertJsonPath('data.qty_after', 20);

        expect(StockMovement::query()->where('type', 'count')->sole()->unit_cost_cents)->toBe(1575)
            ->and(lastAudit('stock.adjusted')->changes['type'])->toBe('count');
    });

    it('records wastage, down to exactly zero', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['type' => 'wastage', 'qty_delta' => -26, 'reason' => 'Spoiled']))
            ->assertCreated()
            ->assertJsonPath('data.type', 'wastage')
            ->assertJsonPath('data.qty_after', 0);

        expect(StockMovement::query()->where('type', 'wastage')->sole()->wholeQtyDelta())->toBe(-26);
    });

    it('keeps a counted_qty without type an adjustment, and an explicit or null type too', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['counted_qty' => 30]))->assertCreated()->assertJsonPath('data.type', 'adjustment');
        adjustStock($this->manager, $this->icedTea, adjustment(['type' => 'adjustment', 'qty_delta' => -1]))->assertCreated()->assertJsonPath('data.type', 'adjustment');
        adjustStock($this->manager, $this->icedTea, adjustment(['type' => null, 'qty_delta' => 1]))->assertCreated()->assertJsonPath('data.type', 'adjustment');

        expect(StockMovement::query()->where('type', 'adjustment')->count())->toBe(3);
    });

    it('refuses wastage below zero with the Phase 3 message', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['type' => 'wastage', 'qty_delta' => -27]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => "Stock can't go below zero (26 on hand).",
                'errors' => ['qty_delta' => ["Stock can't go below zero (26 on hand)."]],
            ]);
    });

    it('refuses a count equal to the stock on hand', function () {
        adjustStock($this->manager, $this->icedTea, adjustment(['type' => 'count', 'counted_qty' => 26]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['counted_qty' => 'Stock is already 26.']);
    });

    it('validates each type', function (array $body, string $field, string $message) {
        adjustStock($this->manager, $this->icedTea, adjustment($body))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(stockOf($this->icedTea))->toBe(26);
    })->with([
        'unknown type' => [['type' => 'sale', 'qty_delta' => 1], 'type', 'The selected type is invalid.'],
        'receipt negative' => [['type' => 'receipt', 'qty_delta' => -5], 'qty_delta', 'Stock in must add stock.'],
        'receipt zero' => [['type' => 'receipt', 'qty_delta' => 0], 'qty_delta', 'Stock in must add stock.'],
        'receipt no qty' => [['type' => 'receipt'], 'qty_delta', 'The qty delta field is required.'],
        'receipt counted' => [['type' => 'receipt', 'qty_delta' => 1, 'counted_qty' => 5], 'counted_qty', 'The counted qty field is prohibited.'],
        'receipt reason too long' => [['type' => 'receipt', 'qty_delta' => 1, 'reason' => str_repeat('r', 256)], 'reason', 'The reason field must not be greater than 255 characters.'],
        'receipt cost negative' => [['type' => 'receipt', 'qty_delta' => 1, 'unit_cost_cents' => -1], 'unit_cost_cents', 'The unit cost cents field must be between 0 and 100000000.'],
        'receipt cost too big' => [['type' => 'receipt', 'qty_delta' => 1, 'unit_cost_cents' => 100000001], 'unit_cost_cents', 'The unit cost cents field must be between 0 and 100000000.'],
        'receipt cost fraction' => [['type' => 'receipt', 'qty_delta' => 1, 'unit_cost_cents' => 12.5], 'unit_cost_cents', 'The unit cost cents field must be an integer.'],
        'wastage positive' => [['type' => 'wastage', 'qty_delta' => 3], 'qty_delta', 'Wastage must remove stock.'],
        'wastage zero' => [['type' => 'wastage', 'qty_delta' => 0], 'qty_delta', 'Wastage must remove stock.'],
        'wastage no reason' => [['type' => 'wastage', 'qty_delta' => -1, 'reason' => null], 'reason', 'The reason field is required.'],
        'wastage counted' => [['type' => 'wastage', 'counted_qty' => 5], 'counted_qty', 'The counted qty field is prohibited.'],
        'count no qty' => [['type' => 'count'], 'counted_qty', 'The counted qty field is required.'],
        'count delta' => [['type' => 'count', 'qty_delta' => 5], 'qty_delta', 'The qty delta field is prohibited.'],
        'count no reason' => [['type' => 'count', 'counted_qty' => 5, 'reason' => null], 'reason', 'The reason field is required.'],
        'count negative' => [['type' => 'count', 'counted_qty' => -1], 'counted_qty', 'The counted qty field must be between 0 and 100000.'],
        'cost on adjustment' => [['qty_delta' => 1, 'unit_cost_cents' => 100], 'unit_cost_cents', 'Only stock in has a unit cost.'],
        'cost on count' => [['type' => 'count', 'counted_qty' => 5, 'unit_cost_cents' => 100], 'unit_cost_cents', 'Only stock in has a unit cost.'],
        'cost on wastage' => [['type' => 'wastage', 'qty_delta' => -1, 'unit_cost_cents' => 0], 'unit_cost_cents', 'Only stock in has a unit cost.'],
    ]);

    it('replays a receipt for the same key and body without writing again', function () {
        $body = adjustment(['type' => 'receipt', 'qty_delta' => 4, 'unit_cost_cents' => 900]);

        $first = adjustStock($this->manager, $this->icedTea, $body)->assertCreated();
        $replay = adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->getContent())->toBe($first->getContent())
            ->and(StockMovement::query()->where('type', 'receipt')->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(30);
    });

    it('rebuilds a committed wastage from the ledger after the key is gone, and 409s for another type', function () {
        $body = adjustment(['type' => 'wastage', 'qty_delta' => -2]);
        $first = adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->json('data');

        IdempotencyKey::query()->delete();
        expect(adjustStock($this->manager, $this->icedTea, $body)->assertCreated()->json('data'))->toBe($first);

        IdempotencyKey::query()->delete();
        adjustStock($this->manager, $this->icedTea, [...$body, 'type' => 'receipt', 'qty_delta' => 2])
            ->assertConflict()
            ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);

        expect(stockOf($this->icedTea))->toBe(24);
    });

    it('returns 403 for a cashier on every type', function (array $body) {
        adjustStock(userWithRole('cashier'), $this->icedTea, adjustment($body))->assertForbidden();
    })->with([
        'receipt' => [['type' => 'receipt', 'qty_delta' => 1]],
        'count' => [['type' => 'count', 'counted_qty' => 1]],
        'wastage' => [['type' => 'wastage', 'qty_delta' => -1]],
    ]);

    it('returns 409 for a product that does not track stock', function () {
        $hotDog = Product::factory()->create(['track_stock' => false]);

        adjustStock($this->manager, $hotDog, adjustment(['type' => 'receipt', 'qty_delta' => 5]))
            ->assertConflict()
            ->assertExactJson(['message' => "This product doesn't track stock."]);
    });
});
