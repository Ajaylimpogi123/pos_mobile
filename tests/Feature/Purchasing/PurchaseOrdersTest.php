<?php

use App\Models\Category;
use App\Models\GoodsReceipt;
use App\Models\IdempotencyKey;
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

    $this->flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
    $this->milk = makeIngredient('Milk', 'mL');
    $this->supplier = makeSupplier('Metro Supply');
    $this->farm = makeSupplier('Bacolod Farms');
    $this->icedTea = Product::factory()->forCategory(Category::factory()->create())->create(['name' => 'Iced Tea', 'track_stock' => true, 'cost_cents' => 1500]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * @return list<string>
 */
function purchaseOrderKeys(): array
{
    return [
        'ulid', 'po_no', 'status', 'receiving_status', 'purchase_request', 'created_by', 'approved_by', 'approved_at',
        'decline_reason', 'expected_delivery_date', 'remarks', 'total_cents', 'lines', 'receipts', 'timeline',
    ];
}

/**
 * A pending PO: requested by the manager, decided by the owner (so its `created_by` is the owner).
 *
 * @param  list<array<string, mixed>>  $items
 * @return array<string, mixed>
 */
function pendingPurchaseOrder(User $requester, User $approver, array $items): array
{
    $pr = approveAllItems($approver, createPurchaseRequest($requester, $items));

    return test()->withToken(tokenFor($approver))->getJson("/api/v1/purchase-orders/{$pr['purchase_order']['ulid']}")->assertOk()->json('data');
}

describe('PO reads', function () {
    it('shows the PO shape and lists with the filters', function () {
        $po = pendingPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000])]);
        $approved = approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->milk, $this->farm, '2', 'L', ['estimated_unit_price_cents' => 9500])]);

        expect(array_keys($po))->toBe(purchaseOrderKeys())
            ->and($po)->toMatchArray([
                'po_no' => 'PO-MAIN-2026-00001', 'status' => 'pending_approval', 'receiving_status' => 'not_received',
                'created_by' => ['id' => $this->owner->id, 'name' => 'Olivia Owner'], 'approved_by' => null, 'approved_at' => null,
                'decline_reason' => null, 'expected_delivery_date' => null, 'remarks' => null, 'total_cents' => 240000, 'receipts' => [],
            ])
            ->and($po['lines'][0])->toMatchArray([
                'qty' => '2.000', 'unit' => 'sack', 'base_qty' => '50000.000', 'unit_price_cents' => 120000, 'line_total_cents' => 240000,
                'received_base_qty' => '0.000', 'received_qty' => '0.000', 'remaining_qty' => '2.000', 'receiving_status' => 'pending',
            ])
            ->and(collect($po['timeline'])->map(fn ($e) => [$e['action'], $e['details']])->all())->toBe([['po.created', 'PO-MAIN-2026-00001']]);

        $token = tokenFor($this->manager);
        $pluck = fn (string $query) => collect($this->withToken($token)->getJson('/api/v1/purchase-orders?'.$query)->assertOk()->json('data'))->pluck('ulid')->all();

        expect($pluck(''))->toBe([$approved['ulid'], $po['ulid']])
            ->and($pluck('status=pending_approval'))->toBe([$po['ulid']])
            ->and($pluck('to_receive=true'))->toBe([$approved['ulid']])
            ->and($pluck('supplier_id='.$this->farm->id))->toBe([$approved['ulid']])
            ->and($pluck('search=flour'))->toBe([$po['ulid']])
            ->and($pluck('receiving_status=fully_received'))->toBe([]);

        expect($this->withToken($token)->getJson('/api/v1/purchase-orders?per_page=1')->json('meta.next_cursor'))->toBeString();
    });

    it('needs a purchase permission or report.view', function () {
        $this->getJson('/api/v1/purchase-orders')->assertUnauthorized();
        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/purchase-orders')->assertForbidden();
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/purchase-orders/'.newUlid())->assertNotFound();
    });
});

describe('PATCH /purchase-orders/{ulid}', function () {
    it('edits lines by id and recomputes the totals while pending', function () {
        $po = pendingPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '2', 'sack')]);
        $lineId = $po['lines'][0]['id'];

        $data = $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/purchase-orders/{$po['ulid']}", [
            'expected_delivery_date' => '2026-10-02',
            'remarks' => 'Deliver early',
            'lines' => [['id' => $lineId, 'qty' => '50', 'unit' => 'kg', 'unit_price_cents' => 4800, 'supplier_id' => $this->farm->id]],
        ])->assertOk()->json('data');

        expect($data)->toMatchArray(['expected_delivery_date' => '2026-10-02', 'remarks' => 'Deliver early', 'total_cents' => 240000])
            ->and($data['lines'][0])->toMatchArray([
                'qty' => '50.000', 'unit' => 'kg', 'base_qty' => '50000.000', 'unit_price_cents' => 4800, 'line_total_cents' => 240000,
                'supplier' => ['id' => $this->farm->id, 'name' => 'Bacolod Farms'],
            ])
            ->and(collect($data['timeline'])->pluck('action')->all())->toBe(['po.created', 'po.updated']);
    });

    it('refuses adding lines, an unknown unit, and edits once approved (409)', function () {
        $po = pendingPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 100])]);
        $token = tokenFor($this->manager);

        $this->withToken($token)->patchJson("/api/v1/purchase-orders/{$po['ulid']}", ['lines' => [['qty' => '1']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['lines.0.id']);
        $this->withToken($token)->patchJson("/api/v1/purchase-orders/{$po['ulid']}", ['lines' => [['id' => $po['lines'][0]['id'], 'unit' => 'tbsp']]])
            ->assertUnprocessable()->assertJsonPath('errors', ['lines.0.unit' => ['Add "tbsp" to Flour\'s units first.']]);

        $this->withToken(tokenFor($this->owner))->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")->assertOk();

        $this->withToken($token)->patchJson("/api/v1/purchase-orders/{$po['ulid']}", ['remarks' => 'x'])
            ->assertConflict()->assertExactJson(['message' => "An approved order can't be edited."]);
        $this->withToken(tokenFor($this->cashier))->patchJson("/api/v1/purchase-orders/{$po['ulid']}", ['remarks' => 'x'])->assertForbidden();
    });
});

describe('approve and decline', function () {
    it('holds the ₱0 gate (422) and approves once every line is priced', function () {
        $po = pendingPurchaseOrder($this->manager, $this->owner, [
            prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000]),
            prItem($this->milk, $this->farm, '1', 'L'),
        ]);
        $token = tokenFor($this->owner);

        $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")
            ->assertUnprocessable()->assertJsonPath('errors', ['lines' => ['Set a price for every line before approving.']]);

        $this->withToken($token)->patchJson("/api/v1/purchase-orders/{$po['ulid']}", ['lines' => [['id' => $po['lines'][1]['id'], 'unit_price_cents' => 9500]]])->assertOk();

        $data = $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")->assertOk()->json('data');

        expect($data)->toMatchArray([
            'status' => 'approved', 'approved_by' => ['id' => $this->owner->id, 'name' => 'Olivia Owner'], 'approved_at' => '2026-09-28T02:00:00Z',
            'total_cents' => 249500,
        ])->and(lastAudit('po.approved')->changes['self_approved'])->toBeTrue();

        $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")
            ->assertConflict()->assertExactJson(['message' => 'This order is no longer pending approval.']);
    });

    it('applies the self-approval rule to the PO creator: an approver without purchase.approve_own 403, another Owner OK', function () {
        // The approver decides the owner's PR, so the approver created the PO.
        $approver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('approver', ['purchase.approve'])->id]);
        $po = pendingPurchaseOrder($this->owner, $approver, [prItem($this->flour, $this->supplier, '1', 'sack', ['estimated_unit_price_cents' => 120000])]);

        $this->withToken(tokenFor($approver))->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")
            ->assertForbidden()->assertExactJson(['message' => 'Someone else must approve your own request.']);
        $this->withToken(tokenFor($approver))->postJson("/api/v1/purchase-orders/{$po['ulid']}/decline", ['reason' => 'x'])
            ->assertForbidden()->assertExactJson(['message' => 'Someone else must approve your own request.']);

        $this->withToken(tokenFor(userWithRole('owner')))->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")->assertOk();
        expect(lastAudit('po.approved')->changes)->not->toHaveKey('self_approved');
    });

    it('refuses a Manager on approve and decline (403: purchase.approve is owner-only)', function () {
        $po = pendingPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '1', 'sack', ['estimated_unit_price_cents' => 120000])]);
        $token = tokenFor($this->manager);

        $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/decline", ['reason' => 'x'])
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);

        // The Manager still reads the POs and can still edit a pending one (purchase.request).
        $this->withToken($token)->getJson("/api/v1/purchase-orders/{$po['ulid']}")->assertOk()->assertJsonPath('data.status', 'pending_approval');
        expect(collect($this->withToken($token)->getJson('/api/v1/purchase-orders')->assertOk()->json('data'))->pluck('ulid')->all())->toBe([$po['ulid']]);
        $this->withToken($token)->patchJson("/api/v1/purchase-orders/{$po['ulid']}", ['remarks' => 'Deliver early'])->assertOk();
    });

    it('declines with a reason', function () {
        $po = pendingPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $token = tokenFor($this->owner);

        $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/decline", [])->assertUnprocessable()->assertJsonValidationErrors(['reason']);

        $data = $this->withToken($token)->postJson("/api/v1/purchase-orders/{$po['ulid']}/decline", ['reason' => 'Supplier out of stock'])
            ->assertOk()->json('data');

        expect($data)->toMatchArray(['status' => 'declined', 'decline_reason' => 'Supplier out of stock'])
            ->and(end($data['timeline'])['details'])->toBe('Supplier out of stock');

        postReceipt($this->owner, $po['ulid'], [['po_line_id' => $po['lines'][0]['id'], 'qty' => '1', 'unit' => 'sack']])
            ->assertConflict()->assertExactJson(['message' => 'Approve the order before receiving.']);
    });

    it('needs purchase.approve', function () {
        $this->postJson('/api/v1/purchase-orders/'.newUlid().'/approve')->assertUnauthorized();

        $po = pendingPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '1', 'sack', ['estimated_unit_price_cents' => 1])]);
        $buyer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('buyer', ['purchase.request', 'purchase.receive'])->id]);

        $this->withToken(tokenFor($buyer))->postJson("/api/v1/purchase-orders/{$po['ulid']}/approve")->assertForbidden();
    });
});

describe('POST /purchase-orders/{ulid}/receipts', function () {
    it('follows worked example I: partial, over-received, then a correction to complete', function () {
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000', 20000);
        $po = approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000])]);
        $lineId = $po['lines'][0]['id'];
        expect($po['lines'][0]['line_total_cents'])->toBe(240000);

        // 2. One sack: 25000.000 g costing 120000; the line is partial, the PO partially received.
        $data = postReceipt($this->manager, $po['ulid'], [['po_line_id' => $lineId, 'qty' => '1', 'unit' => 'sack']], remarks: 'First drop')
            ->assertCreated()->json('data');

        expect($data['receiving_status'])->toBe('partially_received')
            ->and($data['lines'][0])->toMatchArray(['received_base_qty' => '25000.000', 'received_qty' => '1.000', 'remaining_qty' => '1.000', 'receiving_status' => 'partial'])
            ->and($data['receipts'][0])->toMatchArray([
                'received_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'], 'received_at' => '2026-09-28T02:00:00Z', 'remarks' => 'First drop',
                'lines' => [['po_line_id' => $lineId, 'qty' => '1.000', 'unit' => 'sack', 'base_qty' => '25000.000', 'cost_cents' => 120000, 'reason' => null]],
            ])
            ->and((string) ingredientLevel($this->flour)->avg_cost)->toBe('4.666667');

        // 3. 1.2 sack: 30000.000 g costing 144000; received 2.200 > 2, over-received, fully received.
        $data = postReceipt($this->manager, $po['ulid'], [['po_line_id' => $lineId, 'qty' => '1.2', 'unit' => 'sack']])->assertCreated()->json('data');

        expect($data['receiving_status'])->toBe('fully_received')
            ->and($data['lines'][0])->toMatchArray(['received_qty' => '2.200', 'remaining_qty' => '0.000', 'receiving_status' => 'over_received'])
            ->and($data['receipts'][0]['lines'][0]['cost_cents'])->toBe(144000);

        // 4. A correction of −0.2 sack ("Counted wrong") brings the line to complete.
        $data = postReceipt($this->manager, $po['ulid'], [['po_line_id' => $lineId, 'qty' => '-0.2', 'unit' => 'sack', 'reason' => 'Counted wrong']])
            ->assertCreated()->json('data');

        expect($data['lines'][0])->toMatchArray(['received_qty' => '2.000', 'receiving_status' => 'complete'])
            ->and($data['receiving_status'])->toBe('fully_received')
            ->and($data['receipts'][0]['lines'][0])->toMatchArray(['qty' => '-0.200', 'base_qty' => '-5000.000', 'cost_cents' => -24000, 'reason' => 'Counted wrong'])
            ->and(collect($data['receipts'])->count())->toBe(3)
            ->and(end($data['timeline'])['details'])->toBe('-0.2 sack Flour: Counted wrong');

        // The ledger: every receipt is a `receipt` movement referencing its goods receipt.
        $movements = StockMovement::query()->where('ingredient_id', $this->flour->id)->where('type', 'receipt')->orderBy('id')->get();
        expect($movements->pluck('value_cents')->all())->toBe([20000, 120000, 144000, -24000])
            ->and($movements->last()->reference_type)->toBe((new GoodsReceipt)->getMorphClass())
            ->and((string) ingredientLevel($this->flour)->qty)->toBe('55000.000');

        expectIngredientLedgerConsistent($this->flour);

        $history = $this->withToken(tokenFor($this->manager))->getJson("/api/v1/inventory/ingredients/{$this->flour->id}/movements")->json('data');
        expect($history[0]['reference'])->toBe(['kind' => 'purchase_order', 'ulid' => $po['ulid'], 'label' => $po['po_no']])
            ->and($history[0])->toMatchArray(['entered_qty' => '-0.200', 'entered_unit' => 'sack', 'unit_cost_cents' => 120000]);
    });

    it('refuses a correction below 0 and a correction without a reason', function () {
        $po = approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000])]);
        $lineId = $po['lines'][0]['id'];
        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $lineId, 'qty' => '1', 'unit' => 'sack']])->assertCreated();

        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $lineId, 'qty' => '-1.5', 'unit' => 'sack', 'reason' => 'x']])
            ->assertUnprocessable()->assertJsonPath('errors', ['lines.0.qty' => ['Only 1.000 sack was received.']]);
        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $lineId, 'qty' => '-0.5', 'unit' => 'sack']])
            ->assertUnprocessable()->assertJsonPath('errors', ['lines.0.reason' => ['Give a reason for the correction.']]);

        expect(GoodsReceipt::query()->count())->toBe(1);
    });

    it('receives in another valid unit at the line\'s cost basis, and products into their stock', function () {
        $po = approvedPurchaseOrder($this->manager, $this->owner, [
            prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000]),
            prItem($this->icedTea, $this->supplier, 24, 'pc', ['estimated_unit_price_cents' => 1400]),
        ]);
        [$flourLine, $teaLine] = $po['lines'];

        $data = postReceipt($this->manager, $po['ulid'], [
            ['po_line_id' => $flourLine['id'], 'qty' => '10', 'unit' => 'kg'],
            ['po_line_id' => $teaLine['id'], 'qty' => 24, 'unit' => 'pc'],
        ])->assertCreated()->json('data');

        expect($data['lines'][0])->toMatchArray(['received_base_qty' => '10000.000', 'received_qty' => '0.400', 'receiving_status' => 'partial'])
            ->and($data['lines'][1])->toMatchArray(['received_base_qty' => 24, 'received_qty' => 24, 'remaining_qty' => 0, 'receiving_status' => 'complete'])
            ->and($data['receipts'][0]['lines'][0]['cost_cents'])->toBe(48000)
            ->and(stockOf($this->icedTea))->toBe(24);

        $teaMovement = StockMovement::query()->where('product_id', $this->icedTea->id)->sole();
        expect($teaMovement->type)->toBe('receipt')->and($teaMovement->unit_cost_cents)->toBe(1400)
            ->and(StockMovement::query()->where('ingredient_id', $this->flour->id)->sole()->unit_cost_cents)->toBe(4800);

        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $teaLine['id'], 'qty' => '1.5', 'unit' => 'pc']])
            ->assertUnprocessable()->assertJsonPath('errors', ['lines.0.qty' => ['A product quantity must be a whole number.']]);
        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $flourLine['id'], 'qty' => '1', 'unit' => 'L']])
            ->assertUnprocessable()->assertJsonPath('errors', ['lines.0.unit' => ['Add "L" to Flour\'s units first.']]);

        expectReconciled();
    });

    it('is idempotent by ulid, and validates the body', function () {
        $po = approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000])]);
        $other = approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->milk, $this->farm, '1', 'L', ['estimated_unit_price_cents' => 9500])]);
        $line = [['po_line_id' => $po['lines'][0]['id'], 'qty' => '1', 'unit' => 'sack']];
        $ulid = newUlid();

        $first = postReceipt($this->manager, $po['ulid'], $line, $ulid)->assertCreated()->json();
        postReceipt($this->manager, $po['ulid'], $line, $ulid)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        IdempotencyKey::query()->delete();
        expect(postReceipt($this->manager, $po['ulid'], $line, $ulid)->assertCreated()->json('data.lines.0.received_qty'))->toBe('1.000')
            ->and(GoodsReceipt::query()->count())->toBe(1)
            ->and($first['data']['lines'][0]['received_qty'])->toBe('1.000');

        IdempotencyKey::query()->delete();
        postReceipt($this->manager, $other['ulid'], [['po_line_id' => $other['lines'][0]['id'], 'qty' => '1', 'unit' => 'L']], $ulid)
            ->assertConflict()->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);

        postReceipt($this->manager, $po['ulid'], [])->assertUnprocessable()->assertJsonValidationErrors(['lines']);
        postReceipt($this->manager, $po['ulid'], [['po_line_id' => $other['lines'][0]['id'], 'qty' => '0', 'unit' => 'sack']])
            ->assertUnprocessable()->assertJsonValidationErrors(['lines.0.po_line_id', 'lines.0.qty']);
    });

    it('needs purchase.receive', function () {
        $this->postJson('/api/v1/purchase-orders/'.newUlid().'/receipts', [])->assertUnauthorized();

        $po = approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->flour, $this->supplier, '1', 'sack', ['estimated_unit_price_cents' => 1])]);
        $approver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('approver', ['purchase.approve'])->id]);

        postReceipt($approver, $po['ulid'], [['po_line_id' => $po['lines'][0]['id'], 'qty' => '1', 'unit' => 'sack']])->assertForbidden();
    });
});
