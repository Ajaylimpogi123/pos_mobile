<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-27 05:10:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $this->icedTea = Product::factory()->forCategory($drinks)->create([
        'name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1200, 'track_stock' => true,
    ]);
});

afterEach(function () {
    Carbon::setTestNow();
});

function listMovements(User $user, Product|int $product, string $query = ''): TestResponse
{
    $id = $product instanceof Product ? $product->id : $product;

    return test()->withToken(tokenFor($user))->getJson("/api/v1/inventory/{$id}/movements".($query === '' ? '' : "?{$query}"));
}

/**
 * A small ledger: opening 50, stock in 24, wastage 4, a count of 65, and an adjustment of +10
 * backdated between the stock in and the wastage (inserted last).
 */
function seedLedger(Product $product, User $actor): void
{
    recordMovement($product, 'opening', 50, '2026-09-20 01:00:00', reason: 'Opening stock');
    recordMovement($product, 'receipt', 24, '2026-09-21 01:00:00', actor: $actor, reason: 'Delivery');
    recordMovement($product, 'wastage', -4, '2026-09-22 01:00:00', actor: $actor, reason: 'Spoiled');
    recordMovement($product, 'count', -5, '2026-09-23 01:00:00', actor: $actor, reason: 'Weekly count');
    recordMovement($product, 'adjustment', 10, '2026-09-21 12:00:00', actor: $actor, reason: 'Found a case');
}

describe('GET /inventory/{product}/movements', function () {
    it('lists the movements newest first with the running balance of the whole ledger', function () {
        seedLedger($this->icedTea, $this->manager);

        $response = listMovements($this->manager, $this->icedTea)->assertOk();

        $response->assertJsonStructure([
            'data' => [['ulid', 'type', 'qty_delta', 'qty_after', 'unit_cost_cents', 'reason', 'occurred_at', 'created_by', 'reference']],
            'links' => ['first', 'last', 'prev', 'next'],
            'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor'],
        ]);

        expect(array_map(fn (array $m) => [$m['type'], $m['qty_delta'], $m['qty_after']], $response->json('data')))->toBe([
            ['count', -5, 75],
            ['wastage', -4, 80],
            ['adjustment', 10, 84],
            ['receipt', 24, 74],
            ['opening', 50, 50],
        ])
            ->and(stockOf($this->icedTea))->toBe(75);

        $receipt = $response->json('data.3');
        expect(array_keys($receipt))->toBe(['ulid', 'type', 'qty_delta', 'qty_after', 'unit_cost_cents', 'reason', 'occurred_at', 'created_by', 'reference'])
            ->and($receipt)->toMatchArray([
                'type' => 'receipt', 'qty_delta' => 24, 'qty_after' => 74, 'unit_cost_cents' => 1200, 'reason' => 'Delivery',
                'occurred_at' => '2026-09-21T01:00:00Z',
                'created_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
                'reference' => null,
            ])
            ->and($response->json('data.4.created_by'))->toBeNull();
    });

    it('keeps the running balance across pages', function () {
        seedLedger($this->icedTea, $this->manager);

        $pages = [];
        $cursor = null;

        do {
            $response = listMovements($this->manager, $this->icedTea, 'per_page=2'.($cursor ? "&cursor={$cursor}" : ''))->assertOk();
            $pages[] = array_column($response->json('data'), 'qty_after');
            $cursor = $response->json('meta.next_cursor');
        } while ($cursor !== null);

        expect($pages)->toBe([[75, 80], [84, 74], [50]]);
    });

    it('keeps the whole-ledger balance under a type filter', function () {
        seedLedger($this->icedTea, $this->manager);

        $receipts = listMovements($this->manager, $this->icedTea, 'type=receipt')->assertOk()->json('data');
        $wastage = listMovements($this->manager, $this->icedTea, 'type=wastage&per_page=1')->assertOk()->json('data');

        expect(array_map(fn (array $m) => [$m['type'], $m['qty_after']], $receipts))->toBe([['receipt', 74]])
            ->and(array_map(fn (array $m) => [$m['type'], $m['qty_after']], $wastage))->toBe([['wastage', 80]])
            ->and(listMovements($this->manager, $this->icedTea, 'type=sale')->assertOk()->json('data'))->toBe([]);
    });

    it('references the order of a sale and a void, and the order of a refund', function () {
        stockUp($this->icedTea, 50);

        $carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
        $installId = newUlid();
        $token = deviceToken($carla, $installId);
        $managerToken = deviceToken($this->manager, $installId);
        $shift = openShift($token, $carla);

        Carbon::setTestNow('2026-09-27 05:11:00');
        $voided = sell($carla, [[$this->icedTea, 2]], ['shift_ulid' => $shift['ulid']]);
        Carbon::setTestNow('2026-09-27 05:12:00');
        postVoid($managerToken, $voided['ulid'], voidBody())->assertOk();
        Carbon::setTestNow('2026-09-27 05:13:00');
        $refunded = sell($carla, [[$this->icedTea, 3]], ['shift_ulid' => $shift['ulid']]);
        Carbon::setTestNow('2026-09-27 05:14:00');
        postRefund($managerToken, $refunded['ulid'], refundBody($shift['ulid'], [[$refunded['items'][0]['id'], 1]], [['method' => 'cash', 'amount_cents' => 3500]]))
            ->assertCreated();

        $data = listMovements($this->manager, $this->icedTea)->assertOk()->json('data');

        expect(array_map(fn (array $m) => [$m['type'], $m['qty_delta'], $m['qty_after'], $m['reference']], $data))->toBe([
            ['refund', 1, 48, ['kind' => 'refund', 'ulid' => $refunded['ulid'], 'label' => $refunded['invoice_no']]],
            ['sale', -3, 47, ['kind' => 'order', 'ulid' => $refunded['ulid'], 'label' => $refunded['invoice_no']]],
            ['void', 2, 50, ['kind' => 'order', 'ulid' => $voided['ulid'], 'label' => $voided['invoice_no']]],
            ['sale', -2, 48, ['kind' => 'order', 'ulid' => $voided['ulid'], 'label' => $voided['invoice_no']]],
            ['opening', 50, 50, null],
        ])
            ->and($voided['invoice_no'])->not->toBeNull()
            ->and(stockOf($this->icedTea))->toBe(48);

        expectReconciled();
    });

    it('still shows the history of a product that stopped tracking stock', function () {
        stockUp($this->icedTea, 5);
        $this->icedTea->update(['track_stock' => false]);

        expect(listMovements($this->manager, $this->icedTea)->assertOk()->json('data'))->toHaveCount(1);
    });

    it('covers the caller\'s branch only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        stockUp($this->icedTea, 50);
        recordMovement($this->icedTea, 'receipt', 7, branch: $north);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();

        $data = listMovements($northManager, $this->icedTea)->assertOk()->json('data');

        expect(array_map(fn (array $m) => [$m['type'], $m['qty_after']], $data))->toBe([['receipt', 7]]);
    });

    it('validates the query', function (string $query, string $field) {
        listMovements($this->manager, $this->icedTea, $query)->assertUnprocessable()->assertJsonValidationErrors([$field]);
    })->with([
        'unknown type' => ['type=transfer', 'type'],
        'per_page too big' => ['per_page=101', 'per_page'],
    ]);

    it('accepts every movement type as a filter', function (string $type) {
        listMovements($this->manager, $this->icedTea, "type={$type}")->assertOk();
    })->with(['sale', 'adjustment', 'opening', 'void', 'refund', 'receipt', 'count', 'wastage']);

    it('is open to inventory.adjust or report.view, and 403 otherwise', function () {
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);
        $clerk = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('clerk', ['inventory.adjust'])->id]);

        listMovements($viewer, $this->icedTea)->assertOk();
        listMovements($clerk, $this->icedTea)->assertOk();
        listMovements(userWithRole('cashier'), $this->icedTea)
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 404 for an unknown or deleted product', function () {
        listMovements($this->manager, 999999)->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);

        $this->icedTea->delete();
        listMovements($this->manager, $this->icedTea)->assertNotFound();
    });

    it('returns 401 without a token', function () {
        $this->getJson("/api/v1/inventory/{$this->icedTea->id}/movements")
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});
