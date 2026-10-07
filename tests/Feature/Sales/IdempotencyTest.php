<?php

use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Actions\Sales\CompleteSaleAction;
use App\Models\Branch;
use App\Models\Category;
use App\Models\IdempotencyKey;
use App\Models\Order;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use App\Rules\IdempotencyKeyHeader;
use App\Support\RequestFingerprint;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-25 04:12:09');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->manager = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $this->icedTea = Product::factory()->forCategory($drinks)->create([
        'name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true,
    ]);
    stockUp($this->icedTea, 50);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A sale of 2 Iced Teas with a 50% manual discount: it needs a manager's approval.
 */
function approvedSale(string $pin = '2468'): array
{
    return simpleSale([[test()->icedTea, 2]], [
        'discount' => ['type' => 'manual', 'kind' => 'percent', 'value' => 5000],
        'client_total_cents' => 3500,
        'payments' => [['method' => 'cash', 'amount_cents' => 5000, 'reference_no' => null]],
        'discount_authorization' => ['user_id' => test()->manager->id, 'pin' => $pin],
    ]);
}

describe('replay', function () {
    it('returns the stored status and body with Idempotency-Replayed, and writes nothing twice', function () {
        $payload = simpleSale([[$this->icedTea, 3]]);

        $first = postOrder($this->cashier, $payload)->assertCreated();
        expect($first->headers->has('Idempotency-Replayed'))->toBeFalse();

        $this->travel(5)->minutes();
        $replay = postOrder($this->cashier, $payload);

        $replay->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
        expect($replay->getContent())->toBe($first->getContent())
            ->and(Order::query()->count())->toBe(1)
            ->and(StockMovement::query()->where('type', 'sale')->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(47)
            ->and(DB::table('sequences')->where('name', 'invoice')->value('next_value'))->toBe(2)
            ->and(DB::table('sequences')->where('name', 'queue')->value('next_value'))->toBe(2);

        // The next sale still gets the next numbers.
        expect(sell($this->cashier, [[$this->icedTea, 1]]))->toMatchArray(['invoice_no' => 'INV-MAIN-00000002', 'queue_no' => 2]);
    });

    it('compares bodies as JSON: key order and the PIN do not matter', function () {
        $payload = approvedSale();
        $first = postOrder($this->cashier, $payload)->assertCreated();

        // Same body with the keys in another order and a different (wrong) PIN.
        $reordered = array_reverse($payload, true);
        $reordered['discount_authorization'] = ['pin' => '0000', 'user_id' => $this->manager->id];

        $replay = postOrder($this->cashier, $reordered)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->getContent())->toBe($first->getContent())
            ->and(Order::query()->count())->toBe(1);
    });

    it('replays before validation, route model binding and authorization', function () {
        $product = Product::factory()->create(['track_stock' => true]);
        $body = ['ulid' => newUlid(), 'qty_delta' => 5, 'reason' => 'Delivery'];
        $url = "/api/v1/admin/products/{$product->id}/stock-adjustments";
        $token = tokenFor($this->manager);

        $first = $this->withToken($token)->postJson($url, $body, ['Idempotency-Key' => $body['ulid']])->assertCreated();

        // The product is gone and the manager lost inventory.adjust: the replay is still the stored 201.
        $product->delete();
        $this->manager->role->permissions()->detach(DB::table('permissions')->where('slug', 'inventory.adjust')->value('id'));

        $replay = $this->withToken($token)->postJson($url, $body, ['Idempotency-Key' => $body['ulid']])
            ->assertCreated()
            ->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->getContent())->toBe($first->getContent())
            ->and(StockMovement::query()->where('type', 'adjustment')->count())->toBe(1);
    });

    it('gives the stored response to whoever sends the same key and body (e.g. after a PIN switch)', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);
        $first = postOrder($this->cashier, $payload)->assertCreated();

        $replay = postOrder($this->manager, $payload)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->json('data.cashier.id'))->toBe($this->cashier->id)
            ->and($replay->getContent())->toBe($first->getContent());
    });

    it('never stores the PIN', function () {
        $payload = approvedSale();
        postOrder($this->cashier, $payload)->assertCreated();

        $record = IdempotencyKey::query()->sole();
        $row = json_encode(DB::table('idempotency_keys')->first());

        expect($record->key)->toBe($payload['ulid'])
            ->and($record->status)->toBe('completed')
            ->and($record->response_status)->toBe(201)
            ->and($record->endpoint)->toBe('POST api/v1/orders')
            ->and($record->user_id)->toBe($this->cashier->id)
            ->and(str_contains($row, '2468'))->toBeFalse()
            ->and(str_contains($row, '"pin"'))->toBeFalse();
    });
});

describe('conflicts (409)', function () {
    it('rejects the same key with a different body', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);
        postOrder($this->cashier, $payload)->assertCreated();

        $changed = $payload;
        $changed['items'][0]['qty'] = 2;
        $changed['client_total_cents'] = 7000;
        $changed['payments'][0]['amount_cents'] = 7000;

        postOrder($this->cashier, $changed)->assertConflict()
            ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);

        expect(Order::query()->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(49);
    });

    it('rejects the same key on a different endpoint', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);
        postOrder($this->cashier, $payload)->assertCreated();

        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/products/{$this->icedTea->id}/stock-adjustments", [
                'ulid' => $payload['ulid'], 'qty_delta' => 1, 'reason' => 'Test',
            ], ['Idempotency-Key' => $payload['ulid']])
            ->assertConflict()
            ->assertExactJson(['message' => ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST]);

        expect(StockMovement::query()->where('type', 'adjustment')->count())->toBe(0);
    });

    it('rejects a key whose first request is still being processed', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);
        $hash = RequestFingerprint::of($payload);

        (new IdempotencyKey)->forceFill([
            'key' => $payload['ulid'],
            'branch_id' => $this->branch->id,
            'user_id' => $this->cashier->id,
            'endpoint' => 'POST api/v1/orders',
            'request_hash' => $hash,
            'status' => 'processing',
        ])->save();

        postOrder($this->cashier, $payload)->assertConflict()
            ->assertExactJson(['message' => 'This request is still being processed. Try again in a moment.']);

        expect(Order::query()->count())->toBe(0);

        // A different body with a key in flight is still "a different request".
        $other = $payload;
        $other['notes'] = 'Changed';
        postOrder($this->cashier, $other)->assertConflict()
            ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);
    });

    it('takes over a processing key whose request died long ago', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);

        (new IdempotencyKey)->forceFill([
            'key' => $payload['ulid'],
            'branch_id' => $this->branch->id,
            'user_id' => $this->cashier->id,
            'endpoint' => 'POST api/v1/orders',
            'request_hash' => RequestFingerprint::of($payload),
            'status' => 'processing',
        ])->save();

        $this->travel(IdempotencyKey::STALE_AFTER_SECONDS - 1)->seconds();
        postOrder($this->cashier, $payload)->assertConflict();

        $this->travel(1)->seconds();
        postOrder($this->cashier, $payload)->assertCreated();

        expect(IdempotencyKey::query()->sole()->status)->toBe('completed')
            ->and(Order::query()->count())->toBe(1);
    });
});

describe('failures do not use up the key', function () {
    it('lets a corrected request succeed with the same key after a 422', function () {
        $payload = simpleSale([[$this->icedTea, 2]]);
        $short = $payload;
        $short['payments'][0]['amount_cents'] = 5000;

        postOrder($this->cashier, $short)->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => 'The payment is short by ₱20.00.']);

        expect(IdempotencyKey::query()->count())->toBe(0);

        postOrder($this->cashier, $payload)->assertCreated();
        expect(Order::query()->sole()->ulid)->toBe($payload['ulid']);
    });

    it('lets the right PIN succeed with the same key after a wrong one', function () {
        postOrder($this->cashier, approvedSale('1111'))->assertUnprocessable();

        $payload = approvedSale('0000');
        postOrder($this->cashier, $payload)->assertUnprocessable()->assertJsonValidationErrors(['discount_authorization.pin']);

        $payload['discount_authorization']['pin'] = '2468';
        postOrder($this->cashier, $payload)->assertCreated()->assertJsonPath('data.authorized_by.id', $this->manager->id);
    });

    it('releases the key after a 403 and a 409', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);

        postOrder($viewer, $payload)->assertForbidden();
        expect(IdempotencyKey::query()->count())->toBe(0);

        $product = Product::factory()->create(['track_stock' => false]);
        $body = ['ulid' => newUlid(), 'qty_delta' => 5, 'reason' => 'Delivery'];
        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/products/{$product->id}/stock-adjustments", $body, ['Idempotency-Key' => $body['ulid']])
            ->assertConflict();
        expect(IdempotencyKey::query()->count())->toBe(0);

        postOrder($this->cashier, $payload)->assertCreated();
    });

    it('releases the key after a server error', function () {
        $payload = simpleSale([[$this->icedTea, 1]]);

        config(['app.debug' => false]);
        $this->mock(CompleteSaleAction::class)->shouldReceive('execute')->once()->andThrow(new RuntimeException('Database went away'));
        postOrder($this->cashier, $payload)->assertStatus(500)->assertJsonStructure(['message']);

        expect(IdempotencyKey::query()->count())->toBe(0);

        $this->forgetMock(CompleteSaleAction::class);
        postOrder($this->cashier, $payload)->assertCreated();
    });
});

describe('the Idempotency-Key header (422)', function () {
    it('is required, a ULID, and equal to the body ulid', function (?string $header) {
        $payload = simpleSale([[$this->icedTea, 1]]);
        $headers = $header === null ? [] : ['Idempotency-Key' => $header === 'OTHER' ? newUlid() : $header];

        $this->withToken(tokenFor($this->cashier))
            ->postJson('/api/v1/orders', $payload, $headers)
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => IdempotencyKeyHeader::MESSAGE,
                'errors' => ['idempotency_key' => [IdempotencyKeyHeader::MESSAGE]],
            ]);

        expect(Order::query()->count())->toBe(0)
            ->and(IdempotencyKey::query()->count())->toBe(0);
    })->with([
        'missing' => [null],
        'empty' => [''],
        'not a ULID' => ['order-123'],
        'lowercase' => [strtolower(newUlid())],
        'another ULID' => ['OTHER'],
    ]);

    it('is reported with the other field errors', function () {
        $this->withToken(tokenFor($this->cashier))
            ->postJson('/api/v1/orders', ['ulid' => 'bad'], ['Idempotency-Key' => 'bad'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'idempotency_key' => "The Idempotency-Key header must be a ULID that matches the request's ulid.",
                'ulid' => 'The ulid field format is invalid.',
                'items',
            ]);
    });

    it('is checked after 403', function () {
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);

        $this->withToken(tokenFor($viewer))->postJson('/api/v1/orders', simpleSale([[$this->icedTea, 1]]))->assertForbidden();
    });

    it('applies to stock adjustments too', function () {
        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/products/{$this->icedTea->id}/stock-adjustments", ['ulid' => newUlid(), 'qty_delta' => 1, 'reason' => 'Test'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['idempotency_key' => IdempotencyKeyHeader::MESSAGE]);
    });
});

it('does not apply to other endpoints', function () {
    $this->withToken(tokenFor($this->cashier))->postJson('/api/v1/customers', ['first_name' => 'Ana'], ['Idempotency-Key' => newUlid()])->assertCreated();
    $this->withToken(tokenFor($this->cashier))->postJson('/api/v1/customers', ['first_name' => 'Ana'])->assertCreated();

    expect(IdempotencyKey::query()->count())->toBe(0);
});

it('never replays another branch\'s response', function () {
    $payload = simpleSale([[$this->icedTea, 1]]);
    postOrder($this->cashier, $payload)->assertCreated();

    $north = Branch::factory()->create(['code' => 'NORTH']);
    $outsider = User::factory()->forBranch($north)->withRole('cashier')->create();

    postOrder($outsider, $payload)->assertConflict()
        ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.'])
        ->assertHeaderMissing('Idempotency-Replayed');

    expect(Order::query()->count())->toBe(1);
});
