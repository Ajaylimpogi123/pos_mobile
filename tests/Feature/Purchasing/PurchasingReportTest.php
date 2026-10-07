<?php

use App\Models\Category;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-28 02:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier');

    $this->flour = makeIngredient('Flour', 'g', ['sack' => '25000']);
    $this->milk = makeIngredient('Milk', 'mL');
    $this->supplier = makeSupplier('Metro Supply');
    $this->farm = makeSupplier('Bacolod Farms');
    $this->icedTea = Product::factory()->forCategory(Category::factory()->create())->create(['name' => 'Iced Tea', 'track_stock' => true]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * An approved PO (flour 2 sack @ ₱1,200, iced tea 24 pc @ ₱14) with 1 sack received, a PR with
 * one item declined and one pending, all today.
 *
 * @return array{po: array<string, mixed>, declined: array<string, mixed>}
 */
function purchasingFixture(User $manager, User $owner, $flour, $milk, $icedTea, $supplier, $farm): array
{
    $po = approvedPurchaseOrder($manager, $owner, [
        prItem($flour, $supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000]),
        prItem($icedTea, $farm, 24, 'pc', ['estimated_unit_price_cents' => 1400]),
    ]);
    postReceipt($manager, $po['ulid'], [['po_line_id' => $po['lines'][0]['id'], 'qty' => '1', 'unit' => 'sack']])->assertCreated();

    $pr = createPurchaseRequest($manager, [prItem($milk, $farm, '3', 'L'), prItem($flour, $supplier, '1', 'sack')]);
    decidePurchaseRequest($owner, $pr['ulid'], [['item_id' => $pr['items'][0]['id'], 'decision' => 'declined', 'reason' => 'Enough milk']])->assertOk();

    return ['po' => $po, 'declined' => $pr];
}

describe('GET /reports/purchasing', function () {
    it('returns a row per PR item with its PO line, and the totals', function () {
        ['po' => $po] = purchasingFixture($this->manager, $this->owner, $this->flour, $this->milk, $this->icedTea, $this->supplier, $this->farm);

        $response = $this->withToken(tokenFor($this->manager))->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28')
            ->assertOk()
            ->assertJsonPath('meta.truncated', false);

        $rows = $response->json('data.rows');

        expect($rows)->toHaveCount(4)
            ->and(array_keys($rows[0]))->toBe([
                'pr_no', 'pr_date', 'requested_by', 'item_name', 'supplier_name', 'requested_qty', 'unit', 'decision',
                'decision_reason', 'decided_by', 'po_no', 'po_status', 'ordered_qty', 'received_qty', 'remaining_qty',
                'line_receiving_status', 'unit_price_cents', 'ordered_cents', 'received_cents', 'last_received_at',
            ])
            ->and($rows[0])->toBe([
                'pr_no' => 'PR-MAIN-2026-00001', 'pr_date' => '2026-09-28', 'requested_by' => 'Marco Manager',
                'item_name' => 'Flour', 'supplier_name' => 'Metro Supply', 'requested_qty' => '2.000', 'unit' => 'sack',
                'decision' => 'approved', 'decision_reason' => null, 'decided_by' => 'Olivia Owner',
                'po_no' => $po['po_no'], 'po_status' => 'approved', 'ordered_qty' => '2.000', 'received_qty' => '1.000',
                'remaining_qty' => '1.000', 'line_receiving_status' => 'partial', 'unit_price_cents' => 120000,
                'ordered_cents' => 240000, 'received_cents' => 120000, 'last_received_at' => '2026-09-28T02:00:00Z',
            ])
            ->and([$rows[1]['requested_qty'], $rows[1]['ordered_qty'], $rows[1]['remaining_qty']])->toBe([24, 24, 24])
            ->and($rows[2])->toMatchArray(['item_name' => 'Milk', 'decision' => 'declined', 'decision_reason' => 'Enough milk', 'po_no' => null, 'ordered_qty' => null, 'received_cents' => null])
            ->and($rows[3])->toMatchArray(['decision' => 'pending', 'decided_by' => null]);

        expect($response->json('data.totals'))->toBe([
            'prs' => 2, 'items' => 4, 'approved' => 2, 'declined' => 1, 'pending' => 1,
            'pos' => ['pending_approval' => 0, 'approved' => 1, 'declined' => 0],
            'ordered_cents' => 240000 + 33600, 'received_cents' => 120000, 'remaining_cents' => 120000 + 33600,
        ]);
    });

    it('applies the filters', function () {
        purchasingFixture($this->manager, $this->owner, $this->flour, $this->milk, $this->icedTea, $this->supplier, $this->farm);
        $token = tokenFor($this->manager);
        $count = fn (string $query) => count($this->withToken($token)->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28&'.$query)->assertOk()->json('data.rows'));

        expect($count('decision=declined'))->toBe(1)
            ->and($count('status=approved'))->toBe(2)
            ->and($count('po_status=approved'))->toBe(2)
            ->and($count('receiving_status=partial'))->toBe(1)
            ->and($count('receiving_status=partially_received'))->toBe(2)
            ->and($count('supplier_id='.$this->farm->id))->toBe(2)
            ->and($count('item_type=ingredient&item_id='.$this->flour->id))->toBe(2)
            ->and($count(''))->toBe(4);

        expect($this->withToken($token)->getJson('/api/v1/reports/purchasing?from=2026-09-27&to=2026-09-27')->json('data.rows'))->toBe([]);

        $this->withToken($token)->getJson('/api/v1/reports/purchasing?from=2026-09-28')->assertUnprocessable()->assertJsonValidationErrors(['to']);
        $this->withToken($token)->getJson('/api/v1/reports/purchasing?from=2025-01-01&to=2026-09-28')
            ->assertUnprocessable()->assertJsonPath('errors.to', ["The range can't be longer than 366 days."]);
        $this->withToken($token)->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28&item_id=1')
            ->assertUnprocessable()->assertJsonValidationErrors(['item_type']);
    });

    it('counts a PO only when a matching item of its PR is on it', function () {
        // One PR: flour approved (on the PO), milk declined (no line).
        $pr = createPurchaseRequest($this->manager, [
            prItem($this->flour, $this->supplier, '1', 'sack', ['estimated_unit_price_cents' => 1000]),
            prItem($this->milk, $this->farm, '1', 'L'),
        ]);
        $decided = decidePurchaseRequest($this->owner, $pr['ulid'], [
            ['item_id' => $pr['items'][0]['id'], 'decision' => 'approved'],
            ['item_id' => $pr['items'][1]['id'], 'decision' => 'declined', 'reason' => 'No'],
        ])->assertOk()->json('data');
        $this->withToken(tokenFor($this->owner))->postJson('/api/v1/purchase-orders/'.$decided['purchase_order']['ulid'].'/approve')->assertOk();
        $token = tokenFor($this->manager);
        $totals = fn (string $query) => $this->withToken($token)->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28'.$query)->assertOk()->json('data.totals');

        expect($totals('&decision=declined'))->toMatchArray([
            'prs' => 1, 'items' => 1, 'declined' => 1,
            'pos' => ['pending_approval' => 0, 'approved' => 0, 'declined' => 0], 'ordered_cents' => 0,
        ])
            ->and($totals('')['pos'])->toBe(['pending_approval' => 0, 'approved' => 1, 'declined' => 0])
            ->and($totals('')['ordered_cents'])->toBe(1000)
            ->and($totals('&po_status=approved'))->toMatchArray(['prs' => 1, 'items' => 1, 'pos' => ['pending_approval' => 0, 'approved' => 1, 'declined' => 0]]);
    });

    it('exports the CSV', function () {
        purchasingFixture($this->manager, $this->owner, $this->flour, $this->milk, $this->icedTea, $this->supplier, $this->farm);

        $response = $this->withToken(tokenFor($this->manager))->get('/api/v1/reports/purchasing/export?from=2026-09-28&to=2026-09-28')
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="purchasing-2026-09-28-2026-09-28.csv"');

        $csv = $response->getContent();
        expect(substr($csv, 0, 3))->toBe("\xEF\xBB\xBF");

        $lines = explode("\r\n", trim(substr($csv, 3)));
        expect($lines[0])->toBe('pr_no,pr_date,requested_by,item_name,supplier_name,requested_qty,unit,decision,decision_reason,decided_by,po_no,po_status,ordered_qty,received_qty,remaining_qty,line_receiving_status,unit_price,ordered,received,last_received_at')
            ->and($lines[1])->toStartWith('PR-MAIN-2026-00001,2026-09-28,"Marco Manager",Flour,"Metro Supply",2.000,sack,approved,,"Olivia Owner",')
            ->and($lines[1])->toContain(',1200.00,2400.00,1200.00,')
            ->and($lines)->toHaveCount(6)
            ->and(end($lines))->toBe('TOTAL,2,,,,4,,,,,,,,,,,,2736.00,1200.00,');
    });

    it('needs report.view or purchase.approve', function () {
        $this->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28')->assertUnauthorized();
        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28')->assertForbidden();

        $buyer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('buyer', ['purchase.request'])->id]);
        $this->withToken(tokenFor($buyer))->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28')->assertForbidden();

        $approver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('approver', ['purchase.approve'])->id]);
        $this->withToken(tokenFor($approver))->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28')->assertOk();

        // A Manager no longer holds purchase.approve (owner-only) but still reads it through report.view.
        expect($this->manager->hasPermission('purchase.approve'))->toBeFalse();
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/reports/purchasing?from=2026-09-28&to=2026-09-28')->assertOk();
        $this->withToken(tokenFor($this->manager))->get('/api/v1/reports/purchasing/export?from=2026-09-28&to=2026-09-28')->assertOk();
    });
});

describe('dashboard', function () {
    it('shows the purchasing and ingredient insights to those who act on them', function () {
        createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        // A pending PO.
        approveAllItems($this->owner, createPurchaseRequest($this->manager, [prItem($this->milk, $this->farm, '1', 'L')]));
        approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->icedTea, $this->farm, 1, 'pc', ['estimated_unit_price_cents' => 100])]);
        ingredientMovement($this->milk, StockMovement::TYPE_RECEIPT, '1000', 9500);
        $this->withToken(tokenFor($this->manager))->putJson("/api/v1/inventory/ingredients/{$this->milk->id}/reorder-level", ['reorder_level' => ['qty' => '2', 'unit' => 'L']])->assertOk();

        $insights = collect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights'))->keyBy('key');

        expect($insights['ingredients_out'])->toMatchArray(['severity' => 'critical', 'title' => '1 ingredient is out of stock', 'count' => 1, 'action' => 'inventory.ingredients.alerts'])
            ->and($insights['ingredients_low'])->toMatchArray(['severity' => 'warning', 'title' => '1 ingredient is running low', 'action' => 'inventory.ingredients.alerts'])
            ->and($insights['purchase_requests_pending'])->toMatchArray(['severity' => 'warning', 'count' => 1, 'title' => '1 purchase request needs a decision', 'action' => 'purchasing.requests.pending'])
            ->and($insights['purchase_orders_pending'])->toMatchArray(['severity' => 'warning', 'count' => 1, 'action' => 'purchasing.orders.pending'])
            ->and($insights['purchase_orders_to_receive'])->toMatchArray(['severity' => 'info', 'count' => 1, 'title' => '1 purchase order is ready for receiving', 'action' => 'purchasing.orders.to_receive']);

        // The Manager acts on the ingredient and receiving queues but no longer approves (owner-only).
        $managerKeys = collect($this->withToken(tokenFor($this->manager))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights'))->pluck('key');
        expect($managerKeys)->toContain('ingredients_out')->toContain('ingredients_low')->toContain('purchase_orders_to_receive')
            ->not->toContain('purchase_requests_pending')->not->toContain('purchase_orders_pending');

        $cashierKeys = collect($this->withToken(tokenFor($this->cashier))->getJson('/api/v1/dashboard')->json('data.insights'))->pluck('key');
        expect($cashierKeys)->not->toContain('purchase_requests_pending')->not->toContain('ingredients_out');

        $receiver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('receiver', ['purchase.receive'])->id]);
        expect(collect($this->withToken(tokenFor($receiver))->getJson('/api/v1/dashboard')->json('data.insights'))->pluck('key')->all())
            ->toBe(['purchase_orders_to_receive']);
    });

    it('keeps pr.* and po.* out of the activity feed, but shows supplier and ingredient changes', function () {
        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/suppliers', ['name' => 'Zeta Eggs'])->assertCreated();
        approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '1', 'sack', ['estimated_unit_price_cents' => 100])]);

        $activity = $this->withToken(tokenFor($this->owner))->getJson('/api/v1/dashboard')->assertOk()->json('data.activity');
        $actions = collect($activity['recent_changes'])->pluck('action')->all();

        expect($actions)->toBe(['supplier.created'])
            ->and($activity['recent_changes'][0]['summary'])->toBe('Created supplier "Zeta Eggs"')
            ->and(collect($activity['changes_by_day'])->sum('count'))->toBe(1);
    });
});
