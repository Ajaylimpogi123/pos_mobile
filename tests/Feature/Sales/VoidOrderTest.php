<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Device;
use App\Models\Order;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-27.
    Carbon::setTestNow('2026-09-27 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $meals = Category::factory()->create(['name' => 'Meals']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);

    $this->hotDog = Product::factory()->forCategory($breakfast)->create(['name' => 'Hot Dog', 'price_cents' => 8000, 'cost_cents' => 3600]);
    $this->riceCake = Product::factory()->forCategory($meals)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'cost_cents' => 2000, 'is_vatable' => false]);
    $this->icedTea = Product::factory()->forCategory($drinks)->create(['name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true]);
    stockUp($this->icedTea, 50);

    // One tablet (T01), used by both Carla and Marco, with an open shift.
    $this->installId = newUlid();
    $this->token = deviceToken($this->carla, $this->installId);
    $this->marcoToken = deviceToken($this->marco, $this->installId);
    $this->device = Device::query()->sole();
    $this->shift = openShift($this->token, $this->carla);

    $this->order = postOrder($this->carla, voidTestSale($this->shift['ulid']))->assertCreated()->json('data');
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Worked example B (total 25700: GCash 10000, cash 15700 net of 4300 change) in the given shift.
 *
 * @return array<string, mixed>
 */
function voidTestSale(string $shiftUlid, array $overrides = []): array
{
    $t = test();

    return array_replace([
        'ulid' => newUlid(),
        'shift_ulid' => $shiftUlid,
        'customer_id' => null,
        'notes' => null,
        'items' => [
            ['product_id' => $t->hotDog->id, 'qty' => 1, 'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000], 'notes' => null],
            ['product_id' => $t->riceCake->id, 'qty' => 2, 'discount' => null, 'notes' => null],
            ['product_id' => $t->icedTea->id, 'qty' => 3, 'discount' => null, 'notes' => null],
        ],
        'discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 1000],
        'payments' => [
            ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => '1012345678901'],
            ['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null],
        ],
        'client_total_cents' => 25700,
        'discount_authorization' => null,
    ], $overrides);
}

/**
 * Nothing of a void was written: the order is still completed, with no void movement and no audit.
 */
function expectNotVoided(string $ulid): void
{
    expect(Order::query()->where('ulid', $ulid)->sole()->status)->toBe('completed')
        ->and(StockMovement::query()->where('type', 'void')->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'order.voided')->count())->toBe(0)
        ->and(stockOf(test()->icedTea))->toBe(47);
}

describe('success', function () {
    it('voids on the caller\'s own authority and returns 200 with the voided Order', function () {
        $response = postVoid($this->marcoToken, $this->order['ulid'], voidBody())->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(orderKeys())
            ->and($response->json('data'))->toMatchArray([
                'status' => 'voided',
                'voided_at' => '2026-09-27T04:00:00Z',
                'voided_by' => ['id' => $this->marco->id, 'name' => 'Marco Manager'],
                'void_reason' => 'Customer cancelled',
                'void_authorized_by' => null,
                'refunded_cents' => 0,
                'refunds' => [],
                'total_cents' => 25700,
                // Payments are not changed.
                'payments' => $this->order['payments'],
            ]);

        $order = Order::query()->sole();
        expect($order->status)->toBe('voided')
            ->and($order->voided_by)->toBe($this->marco->id)
            ->and($order->void_authorized_by)->toBeNull();
    });

    it('returns the stock with one void movement per stocked product, at the line cost, referencing the order', function () {
        postVoid($this->marcoToken, $this->order['ulid'], voidBody())->assertOk();

        $movement = StockMovement::query()->where('type', 'void')->sole();
        $order = Order::query()->sole();

        expect(stockOf($this->icedTea))->toBe(50)
            ->and($movement->product_id)->toBe($this->icedTea->id)
            ->and($movement->wholeQtyDelta())->toBe(3)
            ->and($movement->unit_cost_cents)->toBe(1575)
            ->and($movement->reference_type)->toBe($order->getMorphClass())
            ->and($movement->reference_id)->toBe($order->id)
            ->and($movement->created_by)->toBe($this->marco->id);

        expectReconciled();
    });

    it('audits order.voided with the invoice, total, reason and approver', function () {
        postVoid($this->marcoToken, $this->order['ulid'], voidBody(['reason' => 'Wrong order']))->assertOk();

        $audit = lastAudit('order.voided');

        expect($audit->actor_id)->toBe($this->marco->id)
            ->and($audit->subject_id)->toBe(Order::query()->sole()->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'invoice_no' => $this->order['invoice_no'],
                'total_cents' => 25700,
                'reason' => 'Wrong order',
                'authorized_by' => null,
            ]));
    });

    it('lets a cashier void with a manager\'s PIN, recording the approver', function () {
        $data = postVoid($this->token, $this->order['ulid'], voidBody([
            'authorization' => ['user_id' => $this->marco->id, 'pin' => '2468'],
        ]))->assertOk()->json('data');

        expect($data['voided_by'])->toBe(['id' => $this->carla->id, 'name' => 'Carla Cashier'])
            ->and($data['void_authorized_by'])->toBe(['id' => $this->marco->id, 'name' => 'Marco Manager'])
            ->and(lastAudit('order.voided')->changes['authorized_by'])->toBe($this->marco->id);
    });

    it('ignores authorization when the caller has sale.void (its PIN is not checked)', function () {
        postVoid($this->marcoToken, $this->order['ulid'], voidBody([
            'authorization' => ['user_id' => $this->marco->id, 'pin' => '0000'],
        ]))->assertOk()->assertJsonPath('data.void_authorized_by', null);
    });

    it('shows the void on GET /orders/{ulid} and filters the list by status', function () {
        $kept = postOrder($this->carla, voidTestSale($this->shift['ulid']))->assertCreated()->json('data');
        postVoid($this->marcoToken, $this->order['ulid'], voidBody())->assertOk();

        $this->withToken(tokenFor($this->carla))->getJson("/api/v1/orders/{$this->order['ulid']}")
            ->assertOk()
            ->assertJsonPath('data.status', 'voided')
            ->assertJsonPath('data.void_reason', 'Customer cancelled');

        $list = fn (string $query) => array_column($this->withToken(tokenFor($this->marco))->getJson('/api/v1/orders?'.$query)->assertOk()->json('data'), 'ulid');

        expect($list('status=voided'))->toBe([$this->order['ulid']])
            ->and($list('status=completed'))->toBe([$kept['ulid']])
            ->and($list('status=refunded'))->toBe([]);

        $this->withToken(tokenFor($this->marco))->getJson('/api/v1/orders?status=open')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['status' => 'The selected status is invalid.']);
    });

    it('voids an offline sale synced into the open shift', function () {
        $offline = offlineOrder($this->carla, [[$this->hotDog, 1]], ['shift_ulid' => $this->shift['ulid']]);
        syncOrders($this->token, [$offline])->assertOk()->assertJsonPath('data.0.status', 'accepted');

        postVoid($this->token, $offline['ulid'], voidBody([
            'authorization' => ['user_id' => $this->marco->id, 'pin' => '2468'],
        ]))->assertOk()->assertJsonPath('data.status', 'voided');
    });
});

describe('idempotency', function () {
    it('replays the stored 200 for the same key and body, writing nothing twice', function () {
        $key = newUlid();
        $first = postVoid($this->marcoToken, $this->order['ulid'], voidBody(), $key)->assertOk();

        $again = postVoid($this->marcoToken, $this->order['ulid'], voidBody(), $key)
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true');

        expect($again->json())->toBe($first->json())
            ->and(StockMovement::query()->where('type', 'void')->count())->toBe(1)
            ->and(AuditLog::query()->where('action', 'order.voided')->count())->toBe(1);
    });

    it('returns 409 for the same key with a different body', function () {
        $key = newUlid();
        postVoid($this->marcoToken, $this->order['ulid'], voidBody(), $key)->assertOk();

        postVoid($this->marcoToken, $this->order['ulid'], voidBody(['reason' => 'Other']), $key)
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);
    });

    it('does not use up the key on a failure', function () {
        $key = newUlid();
        postVoid($this->token, $this->order['ulid'], voidBody(), $key)->assertUnprocessable();

        postVoid($this->token, $this->order['ulid'], voidBody(['authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']]), $key)
            ->assertOk();
    });

    it('requires a ULID Idempotency-Key', function () {
        $this->withToken($this->marcoToken)->postJson("/api/v1/orders/{$this->order['ulid']}/void", voidBody())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['idempotency_key' => "The Idempotency-Key header must be a ULID that matches the request's ulid."]);
    });
});

describe('state and window (409)', function () {
    it('returns 409 for an order already voided', function () {
        postVoid($this->marcoToken, $this->order['ulid'], voidBody())->assertOk();

        postVoid($this->marcoToken, $this->order['ulid'], voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This sale is already voided.']);
    });

    it('returns 409 for an order with refunds', function (string $status) {
        DB::table('orders')->where('ulid', $this->order['ulid'])->update(['status' => $status]);

        postVoid($this->marcoToken, $this->order['ulid'], voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => "This sale has refunds, so it can't be voided. Refund the rest instead."]);
    })->with(['partially_refunded', 'refunded']);

    it('returns 409 when the sale\'s shift is closed', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 0))->assertOk();

        postVoid($this->marcoToken, $this->order['ulid'], voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => "This sale's shift is closed. Refund it instead."]);

        expectNotVoided($this->order['ulid']);
    });

    it('returns 409 when the sale has no shift (before Phase 6) or its shift is unknown', function (Closure $shiftUlid) {
        $order = postOrder($this->carla, voidTestSale(newUlid()))->assertCreated()->json('data');
        DB::table('orders')->where('ulid', $order['ulid'])->update(['shift_ulid' => $shiftUlid()]);

        postVoid($this->marcoToken, $order['ulid'], voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => "This sale's shift is closed. Refund it instead."]);
    })->with([
        'no shift' => [fn () => null],
        'unknown shift' => [fn () => newUlid()],
    ]);

    it('returns 409 on another tablet, naming the tablet that sold it', function () {
        $otherTablet = deviceToken($this->marco);

        postVoid($otherTablet, $this->order['ulid'], voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => "Void this sale on the tablet that sold it ({$this->device->code})."]);
    });

    it('checks the state before the window', function () {
        postVoid($this->marcoToken, $this->order['ulid'], voidBody())->assertOk();
        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 0))->assertOk();

        postVoid($this->marcoToken, $this->order['ulid'], voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This sale is already voided.']);
    });

    it('checks the window before the approval (no PIN is counted)', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 0))->assertOk();

        postVoid($this->token, $this->order['ulid'], voidBody(['authorization' => ['user_id' => $this->marco->id, 'pin' => '0000']]))
            ->assertStatus(409);
    });
});

describe('approval', function () {
    it('returns 422 on authorization when the caller lacks sale.void and sends none', function () {
        postVoid($this->token, $this->order['ulid'], voidBody())
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'A manager must approve this void.',
                'errors' => ['authorization' => ['A manager must approve this void.']],
            ]);

        expectNotVoided($this->order['ulid']);
    });

    it('returns 422 on authorization.user_id for someone who can\'t approve voids', function (Closure $approver) {
        postVoid($this->token, $this->order['ulid'], voidBody(['authorization' => ['user_id' => $approver()?->id ?? 999999, 'pin' => '2468']]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => "This person can't approve voids.",
                'errors' => ['authorization.user_id' => ["This person can't approve voids."]],
            ]);

        expectNotVoided($this->order['ulid']);
    })->with([
        'a cashier' => [fn () => withPin(userWithRole('cashier'), '2468')],
        'without a PIN' => [fn () => userWithRole('manager')],
        'inactive' => [fn () => withPin(userWithRole('manager', ['is_active' => false]), '2468')],
        'deleted' => [fn () => tap(withPin(userWithRole('manager'), '2468'))->delete()],
        'another branch' => [fn () => withPin(User::factory()->forBranch(Branch::factory()->create())->withRole('manager')->create(), '2468')],
        'unknown' => [fn () => null],
        'discount.override without sale.void' => [fn () => withPin(User::factory()->forBranch(test()->branch)->create([
            'role_id' => customRole('supervisor', ['sale.create', 'discount.override'], 100)->id,
        ]), '2468')],
    ]);

    it('returns 422 on authorization.pin for a wrong PIN, and the attempt stays counted', function () {
        $wrong = voidBody(['authorization' => ['user_id' => $this->marco->id, 'pin' => '1111']]);

        for ($i = 0; $i < 5; $i++) {
            postVoid($this->token, $this->order['ulid'], $wrong)
                ->assertUnprocessable()
                ->assertExactJson(['message' => 'Incorrect PIN.', 'errors' => ['authorization.pin' => ['Incorrect PIN.']]]);
        }

        // Locked, even with the right PIN.
        postVoid($this->token, $this->order['ulid'], voidBody(['authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']]))
            ->assertStatus(429)
            ->assertHeader('Retry-After')
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 15 minutes.']);

        expectNotVoided($this->order['ulid']);
    });
});

describe('access and validation', function () {
    it('returns 401 without a token', function () {
        $this->flushHeaders()->postJson("/api/v1/orders/{$this->order['ulid']}/void", voidBody(), ['Idempotency-Key' => newUlid()])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 403 without sale.create or sale.void, before the device and the order', function () {
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view'])->id]);

        postVoid(tokenFor($viewer), newUlid(), voidBody())
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('allows sale.void alone', function () {
        $voider = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('voider', ['sale.void', 'report.view'])->id]);

        postVoid(deviceToken($voider, $this->installId), $this->order['ulid'], voidBody())->assertOk();
    });

    it('returns 409 when the token is not bound to a tablet, before the order is looked up', function () {
        postVoid(tokenFor($this->marco), newUlid(), voidBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);
    });

    it('returns 404 for an order the caller can\'t see', function (Closure $ulid) {
        postVoid($this->token, $ulid(), voidBody())
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    })->with([
        'unknown' => [fn () => newUlid()],
        'another cashier\'s (without report.view)' => [function () {
            return postOrder(test()->marco, voidTestSale(test()->shift['ulid']))->assertCreated()->json('data.ulid');
        }],
        'another branch\'s' => [function () {
            $nick = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('owner')->create();

            return sell($nick, [[test()->hotDog, 1]], ['shift_ulid' => newUlid()])['ulid'];
        }],
    ]);

    it('validates the body', function (array $body, string $field, string $message) {
        postVoid($this->marcoToken, $this->order['ulid'], $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);
    })->with([
        'reason missing' => [['authorization' => null], 'reason', 'The reason field is required.'],
        'reason too long' => [['reason' => str_repeat('x', 256)], 'reason', 'The reason field must not be greater than 255 characters.'],
        'reason not a string' => [['reason' => 12], 'reason', 'The reason field must be a string.'],
        'authorization without pin' => [['reason' => 'x', 'authorization' => ['user_id' => 1]], 'authorization', 'The authorization field must contain entries for: user_id, pin.'],
        'pin too short' => [['reason' => 'x', 'authorization' => ['user_id' => 1, 'pin' => '123']], 'authorization.pin', 'The authorization.pin field format is invalid.'],
        'user_id not an integer' => [['reason' => 'x', 'authorization' => ['user_id' => 'x', 'pin' => '1234']], 'authorization.user_id', 'The authorization.user id field must be an integer.'],
    ]);
});
