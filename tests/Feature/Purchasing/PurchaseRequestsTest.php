<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\IdempotencyKey;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequest;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-28 02:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);

    $this->flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
    $this->milk = makeIngredient('Milk', 'mL');
    $this->supplier = makeSupplier('Metro Supply');
    $this->farm = makeSupplier('Bacolod Farms');
    $this->icedTea = Product::factory()->forCategory(Category::factory()->create())->create(['name' => 'Iced Tea', 'track_stock' => true]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * @return list<string>
 */
function purchaseRequestKeys(): array
{
    return ['ulid', 'pr_no', 'status', 'requested_by', 'date_needed', 'remarks', 'created_at', 'items', 'purchase_order', 'timeline'];
}

describe('POST /purchase-requests', function () {
    it('creates a PR (201) with its number, items and timeline', function () {
        $body = prBody([
            prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000, 'remarks' => 'Bread flour']),
            prItem($this->milk, $this->farm, 1.5, 'L'),
            prItem($this->icedTea, $this->supplier, 24, 'pc'),
        ], ['date_needed' => '2026-10-01', 'remarks' => 'Weekly order']);

        $response = postPurchaseRequest($this->manager, $body)->assertCreated();
        $data = $response->json('data');

        expect(array_keys($data))->toBe(purchaseRequestKeys())
            ->and($data)->toMatchArray([
                'ulid' => $body['ulid'], 'pr_no' => 'PR-MAIN-2026-00001', 'status' => 'pending_approval',
                'requested_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
                'date_needed' => '2026-10-01', 'remarks' => 'Weekly order', 'created_at' => '2026-09-28T02:00:00Z',
                'purchase_order' => null,
            ])
            ->and($data['items'][0])->toBe([
                'id' => $data['items'][0]['id'],
                'item' => ['type' => 'ingredient', 'id' => $this->flour->id, 'name' => 'Flour'],
                'supplier' => ['id' => $this->supplier->id, 'name' => 'Metro Supply'],
                'qty' => '2.000', 'unit' => 'sack', 'base_qty' => '50000.000',
                'estimated_unit_price_cents' => 120000, 'remarks' => 'Bread flour',
                'decision' => 'pending', 'decision_reason' => null, 'decided_by' => null, 'decided_at' => null,
            ])
            ->and([$data['items'][1]['qty'], $data['items'][1]['unit'], $data['items'][1]['base_qty']])->toBe(['1.500', 'L', '1500.000'])
            ->and([$data['items'][2]['item']['type'], $data['items'][2]['qty'], $data['items'][2]['base_qty']])->toBe(['product', 24, 24])
            ->and($data['timeline'])->toBe([[
                'at' => '2026-09-28T02:00:00Z', 'action' => 'pr.created',
                'by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'], 'details' => '3 items',
            ]]);
    });

    it('numbers per branch and year from the sequences table', function () {
        expect(createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'kg')])['pr_no'])->toBe('PR-MAIN-2026-00001')
            ->and(createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'kg')])['pr_no'])->toBe('PR-MAIN-2026-00002');

        $north = Branch::factory()->create(['code' => 'NORTH', 'timezone' => 'Asia/Manila', 'day_start_time' => '04:00:00']);
        $northManager = User::factory()->forBranch($north)->withRole('manager')->create();
        expect(createPurchaseRequest($northManager, [prItem($this->flour, $this->supplier, '1', 'kg')])['pr_no'])->toBe('PR-NORTH-2026-00001');

        Carbon::setTestNow('2027-01-02 02:00:00');
        expect(createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'kg')])['pr_no'])->toBe('PR-MAIN-2027-00001');
    });

    it('is idempotent by ulid', function () {
        $body = prBody([prItem($this->flour, $this->supplier, '1', 'kg')]);

        $first = postPurchaseRequest($this->manager, $body)->assertCreated()->json();
        postPurchaseRequest($this->manager, $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        IdempotencyKey::query()->delete();
        expect(postPurchaseRequest($this->manager, $body)->assertCreated()->json('data.pr_no'))->toBe($first['data']['pr_no'])
            ->and(PurchaseRequest::query()->count())->toBe(1);

        postPurchaseRequest($this->manager, $body, 'not-a-ulid')->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key']);
    });

    it('validates the body and each item', function () {
        $inactiveSupplier = makeSupplier('Closed', ['is_active' => false]);
        $inactive = makeIngredient('Old Sugar', 'g', [], ['is_active' => false]);
        $untracked = Product::factory()->create(['track_stock' => false]);

        postPurchaseRequest($this->manager, prBody([]))->assertUnprocessable()->assertJsonValidationErrors(['items']);
        postPurchaseRequest($this->manager, ['ulid' => newUlid()])->assertUnprocessable()->assertJsonValidationErrors(['items']);

        $response = postPurchaseRequest($this->manager, prBody([
            prItem($this->flour, $inactiveSupplier, '1', 'kg'),
            prItem($inactive, $this->supplier, '1', 'kg'),
            prItem($untracked, $this->supplier, 1, 'pc'),
            prItem($this->icedTea, $this->supplier, '1.5', 'pc'),
            prItem($this->icedTea, $this->supplier, 1, 'kg'),
            prItem($this->flour, $this->supplier, '0', 'kg'),
            prItem($this->flour, $this->supplier, '1.2345', 'kg'),
            prItem($this->flour, $this->supplier, '1', 'kg', ['estimated_unit_price_cents' => '100']),
            ['item_type' => 'recipe', 'item_id' => 1, 'supplier_id' => $this->supplier->id, 'qty' => '1', 'unit' => 'kg'],
        ]))->assertUnprocessable();

        expect($response->json('errors'))->toMatchArray([
            'items.1.item_id' => ['This ingredient is inactive.'],
            'items.2.item_id' => ["This product doesn't track stock."],
            'items.3.qty' => ['A product quantity must be a whole number.'],
            'items.4.unit' => ['Add "kg" to Iced Tea\'s units first.'],
            'items.5.qty' => ['The items.5.qty field must be greater than 0.'],
            'items.6.qty' => ['The items.6.qty field must be a number with at most 3 decimals.'],
        ])->and(array_keys($response->json('errors')))->toContain('items.0.supplier_id', 'items.7.estimated_unit_price_cents', 'items.8.item_type');
    });

    it('needs purchase.request (401, 403)', function () {
        $this->postJson('/api/v1/purchase-requests', [])->assertUnauthorized();
        postPurchaseRequest($this->cashier, prBody([prItem($this->flour, $this->supplier, '1', 'kg')]))->assertForbidden();
    });
});

describe('GET /purchase-requests', function () {
    it('lists newest first with the filters, and needs a purchase permission or report.view', function () {
        $this->getJson('/api/v1/purchase-requests')->assertUnauthorized();

        $first = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'kg')]);
        $second = createPurchaseRequest($this->owner, [prItem($this->milk, $this->farm, '1', 'L')]);
        $token = tokenFor($this->manager);

        $page = $this->withToken($token)->getJson('/api/v1/purchase-requests?per_page=1')->assertOk();
        expect($page->json('data.0.ulid'))->toBe($second['ulid'])
            ->and($page->json('meta.next_cursor'))->toBeString()
            ->and(array_keys($page->json('data.0')))->toBe(purchaseRequestKeys());

        $pluck = fn (string $query) => collect($this->withToken($token)->getJson('/api/v1/purchase-requests?'.$query)->assertOk()->json('data'))->pluck('ulid')->all();

        expect($pluck('mine=true'))->toBe([$first['ulid']])
            ->and($pluck('supplier_id='.$this->farm->id))->toBe([$second['ulid']])
            ->and($pluck('search=milk'))->toBe([$second['ulid']])
            ->and($pluck('search=PR-MAIN-2026-00001'))->toBe([$first['ulid']])
            // A Manager doesn't hold purchase.approve (owner-only): nothing needs their decision.
            ->and($pluck('needs_decision=true'))->toBe([])
            ->and($pluck('status=approved'))->toBe([]);

        // The Owner decides every PR, their own included (purchase.approve_own).
        expect(collect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/purchase-requests?needs_decision=true')->assertOk()->json('data'))->pluck('ulid')->all())
            ->toBe([$second['ulid'], $first['ulid']]);

        // An approver without purchase.approve_own can't decide their own PR: it needs someone else.
        $approver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('approver', ['purchase.request', 'purchase.approve'])->id]);
        $third = createPurchaseRequest($approver, [prItem($this->flour, $this->supplier, '1', 'kg')]);
        expect(collect($this->withToken(tokenFor($approver))->getJson('/api/v1/purchase-requests?needs_decision=true')->assertOk()->json('data'))->pluck('ulid')->all())
            ->toBe([$second['ulid'], $first['ulid']])
            ->and(collect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/purchase-requests?needs_decision=true')->json('data'))->pluck('ulid')->all())
            ->toBe([$third['ulid'], $second['ulid'], $first['ulid']]);

        $this->withToken($token)->getJson('/api/v1/purchase-requests?status=nope')->assertUnprocessable();
        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/purchase-requests')->assertForbidden();
    });

    it('keeps other branches\' PRs out (404)', function () {
        $pr = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'kg')]);
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northOwner = User::factory()->forBranch($north)->withRole('owner')->create();

        $this->withToken(tokenFor($northOwner))->getJson("/api/v1/purchase-requests/{$pr['ulid']}")->assertNotFound();
        expect($this->withToken(tokenFor($northOwner))->getJson('/api/v1/purchase-requests')->json('data'))->toBe([]);
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/purchase-requests/'.newUlid())->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    });
});

describe('PATCH and DELETE /purchase-requests/{ulid}', function () {
    it('edits items by id: changes in place, adds and removes', function () {
        $pr = createPurchaseRequest($this->manager, [
            prItem($this->flour, $this->supplier, '1', 'sack'),
            prItem($this->milk, $this->supplier, '1', 'L'),
        ]);
        [$flourItem, $milkItem] = $pr['items'];

        $data = $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/purchase-requests/{$pr['ulid']}", [
            'remarks' => 'Updated',
            'items' => [
                prItem($this->flour, $this->farm, '3', 'sack', ['id' => $flourItem['id']]),
                prItem($this->icedTea, $this->supplier, 12, 'pc'),
            ],
        ])->assertOk()->json('data');

        expect($data['remarks'])->toBe('Updated')
            ->and(collect($data['items'])->pluck('id')->first())->toBe($flourItem['id'])
            ->and([$data['items'][0]['qty'], $data['items'][0]['supplier']['name']])->toBe(['3.000', 'Bacolod Farms'])
            ->and($data['items'][1]['item']['name'])->toBe('Iced Tea')
            ->and(collect($data['items'])->pluck('id'))->not->toContain($milkItem['id'])
            ->and(collect($data['timeline'])->pluck('action')->all())->toBe(['pr.created', 'pr.updated']);
    });

    it('refuses an item id of another PR', function () {
        $pr = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $other = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);

        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/purchase-requests/{$pr['ulid']}", [
            'items' => [prItem($this->flour, $this->supplier, '1', 'sack', ['id' => $other['items'][0]['id']])],
        ])->assertUnprocessable()->assertJsonValidationErrors(['items.0.id']);
    });

    it('locks editing and cancelling once an item is decided (409)', function () {
        $pr = createPurchaseRequest($this->manager, [
            prItem($this->flour, $this->supplier, '1', 'sack'),
            prItem($this->milk, $this->supplier, '1', 'L'),
        ]);
        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $pr['items'][0]['id'], 'decision' => 'approved']])->assertOk();

        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/purchase-requests/{$pr['ulid']}", ['remarks' => 'x'])
            ->assertConflict()->assertExactJson(['message' => 'This request is already being reviewed.']);
        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/purchase-requests/{$pr['ulid']}")
            ->assertConflict()->assertExactJson(['message' => 'This request is already being reviewed.']);
    });

    it('cancels (204) without deleting, and a cancelled PR is locked', function () {
        $pr = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);

        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/purchase-requests/{$pr['ulid']}")->assertNoContent();

        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/purchase-requests/{$pr['ulid']}")
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        expect(lastAudit('pr.cancelled'))->not->toBeNull();

        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $pr['items'][0]['id'], 'decision' => 'approved']])
            ->assertConflict()->assertExactJson(['message' => 'This request was cancelled.']);
        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/purchase-requests/{$pr['ulid']}")->assertConflict();
    });

    it('lets the requester or purchase.approve edit, nobody else', function () {
        $this->patchJson('/api/v1/purchase-requests/'.newUlid(), [])->assertUnauthorized();

        $pr = createPurchaseRequest($this->owner, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $requester = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('buyer', ['purchase.request'])->id]);

        $secondOwner = userWithRole('owner');

        $this->withToken(tokenFor($requester))->patchJson("/api/v1/purchase-requests/{$pr['ulid']}", ['remarks' => 'x'])->assertForbidden();
        // A Manager holds purchase.request but not purchase.approve (owner-only): not someone else's PR.
        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/purchase-requests/{$pr['ulid']}", ['remarks' => 'x'])->assertForbidden();
        $this->withToken(tokenFor($secondOwner))->patchJson("/api/v1/purchase-requests/{$pr['ulid']}", ['remarks' => 'x'])->assertOk();

        $own = createPurchaseRequest($requester, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $this->withToken(tokenFor($requester))->patchJson("/api/v1/purchase-requests/{$own['ulid']}", ['remarks' => 'x'])->assertOk();
    });
});

describe('POST /purchase-requests/{ulid}/decisions', function () {
    it('approves everything: status approved and one PO with the items, prices prefilled', function () {
        // An earlier approved PO priced Milk at ₱95.00 per L.
        approvedPurchaseOrder($this->manager, $this->owner, [prItem($this->milk, $this->farm, '2', 'L', ['estimated_unit_price_cents' => 9500])]);

        $pr = createPurchaseRequest($this->manager, [
            prItem($this->flour, $this->supplier, '2', 'sack', ['estimated_unit_price_cents' => 120000]),
            prItem($this->milk, $this->farm, '3', 'L'),
            prItem($this->icedTea, $this->supplier, 24, 'pc'),
        ]);

        $data = approveAllItems($this->owner, $pr);

        expect($data['status'])->toBe('approved')
            ->and($data['purchase_order'])->toMatchArray(['po_no' => 'PO-MAIN-2026-00002', 'status' => 'pending_approval'])
            ->and($data['items'][0])->toMatchArray(['decision' => 'approved', 'decided_by' => ['id' => $this->owner->id, 'name' => 'Olivia Owner'], 'decided_at' => '2026-09-28T02:00:00Z']);

        $po = $this->withToken(tokenFor($this->owner))->getJson("/api/v1/purchase-orders/{$data['purchase_order']['ulid']}")->assertOk()->json('data');

        expect(collect($po['lines'])->map(fn ($l) => [$l['item']['name'], $l['supplier']['name'], $l['qty'], $l['unit'], $l['unit_price_cents'], $l['line_total_cents']])->all())
            ->toBe([
                ['Flour', 'Metro Supply', '2.000', 'sack', 120000, 240000],
                ['Milk', 'Bacolod Farms', '3.000', 'L', 9500, 28500],
                ['Iced Tea', 'Metro Supply', 24, 'pc', 0, 0],
            ])
            ->and($po['total_cents'])->toBe(268500)
            ->and($po['created_by'])->toBe(['id' => $this->owner->id, 'name' => 'Olivia Owner'])
            ->and($po['purchase_request'])->toBe(['ulid' => $pr['ulid'], 'pr_no' => $pr['pr_no']]);
    });

    it('declines with a reason, and a partly declined PR still gets a PO of its approved items', function () {
        $pr = createPurchaseRequest($this->manager, [
            prItem($this->flour, $this->supplier, '2', 'sack'),
            prItem($this->milk, $this->farm, '3', 'L'),
        ]);
        [$flourItem, $milkItem] = $pr['items'];

        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $milkItem['id'], 'decision' => 'declined']])
            ->assertUnprocessable()->assertJsonPath('errors', ['decisions.0.reason' => ['Give a reason for declining.']]);

        $partial = decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $milkItem['id'], 'decision' => 'declined', 'reason' => 'Still have stock']])
            ->assertOk()->json('data');
        expect($partial['status'])->toBe('pending_approval')->and($partial['purchase_order'])->toBeNull();

        $done = decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $flourItem['id'], 'decision' => 'approved']])->assertOk()->json('data');

        expect($done['status'])->toBe('partially_approved')
            ->and($done['items'][1])->toMatchArray(['decision' => 'declined', 'decision_reason' => 'Still have stock'])
            ->and(PurchaseOrder::query()->sole()->lines()->count())->toBe(1)
            ->and(collect($done['timeline'])->map(fn ($e) => [$e['action'], $e['details']])->all())->toBe([
                ['pr.created', '2 items'],
                ['pr.item_declined', '3 L Milk: Still have stock'],
                ['pr.item_approved', '2 sack Flour'],
            ]);

        expect(lastAudit('po.created')->changes['po_no'])->toBe('PO-MAIN-2026-00001');
    });

    it('declines everything: status declined and no PO', function () {
        $pr = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '2', 'sack')]);

        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $pr['items'][0]['id'], 'decision' => 'declined', 'reason' => 'No budget']])
            ->assertOk()->assertJsonPath('data.status', 'declined')->assertJsonPath('data.purchase_order', null);

        expect(PurchaseOrder::query()->count())->toBe(0);
    });

    it('refuses an item already decided (409) and validates the decisions', function () {
        $pr = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '2', 'sack'), prItem($this->milk, $this->farm, '1', 'L')]);
        $id = $pr['items'][0]['id'];

        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $id, 'decision' => 'approved']])->assertOk();
        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => $id, 'decision' => 'declined', 'reason' => 'x']])
            ->assertConflict()->assertExactJson(['message' => 'This item was already decided.']);

        decidePurchaseRequest($this->owner, $pr['ulid'], [])->assertUnprocessable()->assertJsonValidationErrors(['decisions']);
        decidePurchaseRequest($this->owner, $pr['ulid'], [['item_id' => 999999, 'decision' => 'maybe']])
            ->assertUnprocessable()->assertJsonValidationErrors(['decisions.0.item_id', 'decisions.0.decision']);
    });

    it('lets the Owner decide their own PR (logged) but not an approver without purchase.approve_own', function () {
        $approver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('approver', ['purchase.request', 'purchase.approve'])->id]);
        $approvers = createPurchaseRequest($approver, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        decidePurchaseRequest($approver, $approvers['ulid'], [['item_id' => $approvers['items'][0]['id'], 'decision' => 'approved']])
            ->assertForbidden()->assertExactJson(['message' => 'Someone else must approve your own request.']);

        $owners = createPurchaseRequest($this->owner, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $data = decidePurchaseRequest($this->owner, $owners['ulid'], [['item_id' => $owners['items'][0]['id'], 'decision' => 'approved']])
            ->assertOk()->json('data');

        expect(lastAudit('pr.item_approved')->changes['self_approved'])->toBeTrue()
            ->and(collect($data['timeline'])->firstWhere('action', 'pr.item_approved')['details'])->toBe('1 sack Flour (self-approved)');

        // Deciding someone else's PR needs only purchase.approve: the approver, or a second Owner.
        $other = createPurchaseRequest($this->owner, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        decidePurchaseRequest($approver, $other['ulid'], [['item_id' => $other['items'][0]['id'], 'decision' => 'approved']])->assertOk();
        expect(lastAudit('pr.item_approved')->changes['self_approved'] ?? false)->toBeFalse();

        $managers = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        decidePurchaseRequest(userWithRole('owner'), $managers['ulid'], [['item_id' => $managers['items'][0]['id'], 'decision' => 'approved']])->assertOk();
    });

    it('refuses a Manager on every decision, their own PR or anyone else\'s (403: owner-only)', function () {
        $own = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $owners = createPurchaseRequest($this->owner, [prItem($this->flour, $this->supplier, '1', 'sack')]);

        decidePurchaseRequest($this->manager, $own['ulid'], [['item_id' => $own['items'][0]['id'], 'decision' => 'approved']])
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        decidePurchaseRequest($this->manager, $owners['ulid'], [['item_id' => $owners['items'][0]['id'], 'decision' => 'approved']])
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        decidePurchaseRequest($this->manager, $owners['ulid'], [['item_id' => $owners['items'][0]['id'], 'decision' => 'declined', 'reason' => 'No budget']])
            ->assertForbidden();

        expect(PurchaseRequest::query()->where('ulid', $owners['ulid'])->sole()->status)->toBe(PurchaseRequest::STATUS_PENDING);
    });

    it('needs purchase.approve (401, 403)', function () {
        $this->postJson('/api/v1/purchase-requests/'.newUlid().'/decisions', [])->assertUnauthorized();

        $pr = createPurchaseRequest($this->manager, [prItem($this->flour, $this->supplier, '1', 'sack')]);
        $buyer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('buyer', ['purchase.request', 'purchase.receive'])->id]);

        decidePurchaseRequest($buyer, $pr['ulid'], [['item_id' => $pr['items'][0]['id'], 'decision' => 'approved']])
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
    });
});
