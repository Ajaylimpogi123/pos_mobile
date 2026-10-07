<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Device;
use App\Models\Order;
use App\Models\Product;
use App\Models\Refund;
use App\Models\RefundItem;
use App\Models\RefundPayment;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 13:10 in Manila: business day 2026-09-27.
    Carbon::setTestNow('2026-09-27 05:10:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $meals = Category::factory()->create(['name' => 'Meals']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);

    $this->hotDog = Product::factory()->forCategory($breakfast)->create(['name' => 'Hot Dog', 'price_cents' => 8000, 'cost_cents' => 3600]);
    $this->riceCake = Product::factory()->forCategory($meals)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'cost_cents' => 2000, 'is_vatable' => false]);
    $this->icedTea = Product::factory()->forCategory($drinks)->create(['name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true]);
    stockUp($this->icedTea, 50);

    $this->installId = newUlid();
    $this->token = deviceToken($this->carla, $this->installId);
    $this->marcoToken = deviceToken($this->marco, $this->installId);
    $this->device = Device::query()->sole();
    $this->shift = openShift($this->token, $this->carla);

    // Worked example B: Hot Dog 6930 (1), Rice Cake 8663 (2, VAT-exempt), Iced Tea 10107 (3);
    // total 25700, paid GCash 10000 + cash 15700 (net of 4300 change).
    $this->order = postOrder($this->carla, refundTestSale($this->shift['ulid']))->assertCreated()->json('data');
    [$this->hotDogLine, $this->riceLine, $this->teaLine] = array_column($this->order['items'], 'id');
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Worked example B in the given shift.
 *
 * @return array<string, mixed>
 */
function refundTestSale(string $shiftUlid): array
{
    $t = test();

    return [
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
    ];
}

/**
 * Worked example C: 1 of the 3 Iced Teas, 3369 back in cash.
 *
 * @return array<string, mixed>
 */
function exampleC(array $overrides = []): array
{
    return refundBody(test()->shift['ulid'], [[test()->teaLine, 1]], [['method' => 'cash', 'amount_cents' => 3369]], $overrides);
}

function expectNoRefundWritten(): void
{
    expect(Refund::query()->count())->toBe(0)
        ->and(RefundItem::query()->count())->toBe(0)
        ->and(RefundPayment::query()->count())->toBe(0)
        ->and(StockMovement::query()->where('type', 'refund')->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'order.refunded')->count())->toBe(0)
        ->and(Order::query()->where('ulid', test()->order['ulid'])->sole()->status)->toBe('completed')
        ->and(stockOf(test()->icedTea))->toBe(47);
}

describe('success', function () {
    it('refunds worked example C and returns 201 with the Order and the exact Refund', function () {
        $body = exampleC();

        $response = postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated();
        $data = $response->json('data');

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($data))->toBe(orderKeys())
            ->and(array_keys($data['items'][0]))->toBe(orderItemKeys())
            ->and(array_keys($data['refunds'][0]))->toBe(refundKeys())
            ->and($data['status'])->toBe('partially_refunded')
            ->and($data['refunded_cents'])->toBe(3369)
            ->and(array_map(fn (array $item) => [$item['refunded_qty'], $item['refunded_cents']], $data['items']))->toBe([[0, 0], [0, 0], [1, 3369]])
            ->and($data['refunds'])->toBe([[
                'ulid' => $body['ulid'],
                'business_date' => '2026-09-27',
                'refunded_at' => '2026-09-27T05:10:00Z',
                'shift_ulid' => $this->shift['ulid'],
                'refunded_by' => ['id' => $this->marco->id, 'name' => 'Marco Manager'],
                'authorized_by' => null,
                'reason' => 'Wrong drink',
                'amount_cents' => 3369,
                'vatable_sales_cents' => 3008,
                'vat_amount_cents' => 361,
                'vat_exempt_sales_cents' => 0,
                'items' => [['order_item_id' => $this->teaLine, 'product_name' => 'Iced Tea', 'qty' => 1, 'amount_cents' => 3369]],
                'payments' => [['method' => 'cash', 'amount_cents' => 3369, 'reference_no' => null]],
            ]])
            // The sale itself is unchanged.
            ->and($data['total_cents'])->toBe(25700)
            ->and($data['payments'])->toBe($this->order['payments']);

        $refund = Refund::query()->sole();
        expect($refund->device_id)->toBe($this->device->id)
            ->and($refund->branch_id)->toBe($this->branch->id)
            ->and(RefundItem::query()->sole()->only(['branch_id', 'business_date', 'product_id', 'category_id']))->toBe([
                'branch_id' => $this->branch->id,
                'business_date' => '2026-09-27',
                'product_id' => $this->icedTea->id,
                'category_id' => $this->icedTea->category_id,
            ]);
    });

    it('returns the stock with a refund movement referencing the refund, and audits order.refunded', function () {
        $body = exampleC();
        postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated();

        $refund = Refund::query()->sole();
        $movement = StockMovement::query()->where('type', 'refund')->sole();

        expect(stockOf($this->icedTea))->toBe(48)
            ->and($movement->wholeQtyDelta())->toBe(1)
            ->and($movement->unit_cost_cents)->toBe(1575)
            ->and($movement->reference_type)->toBe($refund->getMorphClass())
            ->and($movement->reference_id)->toBe($refund->id);

        $audit = lastAudit('order.refunded');
        expect($audit->actor_id)->toBe($this->marco->id)
            ->and($audit->subject_id)->toBe(Order::query()->sole()->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'invoice_no' => $this->order['invoice_no'],
                'refund_ulid' => $body['ulid'],
                'amount_cents' => 3369,
                'reason' => 'Wrong drink',
                'authorized_by' => null,
            ]));

        expectReconciled();
    });

    it('adds partial refunds up to exactly each line total, then marks the sale refunded', function () {
        $refund = fn (array $lines, array $payments) => postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], $lines, $payments))
            ->assertCreated()->json('data');

        // Iced Tea one by one: 3369 each (cumulative rounding), 10107 in all.
        foreach ([1, 2, 3] as $n) {
            $data = $refund([[$this->teaLine, 1]], [['method' => 'cash', 'amount_cents' => 3369]]);
        }
        expect($data['items'][2])->toMatchArray(['refunded_qty' => 3, 'refunded_cents' => 10107]);

        // Rice Cake 8663 in halves: 4332 then 4331.
        $refund([[$this->riceLine, 1]], [['method' => 'gcash', 'amount_cents' => 4332, 'reference_no' => 'R-1']]);
        $data = $refund([[$this->riceLine, 1]], [['method' => 'gcash', 'amount_cents' => 4331, 'reference_no' => 'R-2']]);
        expect($data['items'][1])->toMatchArray(['refunded_qty' => 2, 'refunded_cents' => 8663])
            ->and($data['status'])->toBe('partially_refunded');

        // The last line: split across what each method has left (cash 15700 − 10107, GCash 10000 − 8663).
        $data = $refund([[$this->hotDogLine, 1]], [
            ['method' => 'cash', 'amount_cents' => 5593],
            ['method' => 'gcash', 'amount_cents' => 1337, 'reference_no' => 'R-3'],
        ]);

        expect($data['status'])->toBe('refunded')
            ->and($data['refunded_cents'])->toBe(25700)
            ->and(array_sum(array_column($data['refunds'], 'amount_cents')))->toBe(25700)
            ->and($data['refunds'])->toHaveCount(6)
            ->and(stockOf($this->icedTea))->toBe(50);

        expectReconciled();
    });

    it('refunds everything at once for exactly the total, cash first, with the order VAT split', function () {
        $body = refundBody($this->shift['ulid'], [[$this->hotDogLine, 1], [$this->riceLine, 2], [$this->teaLine, 3]], [
            ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => 'R-9'],
            ['method' => 'cash', 'amount_cents' => 15700],
        ]);

        $data = postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated()->json('data');

        expect($data['status'])->toBe('refunded')
            ->and($data['refunded_cents'])->toBe(25700)
            ->and($data['refunds'][0])->toMatchArray([
                'amount_cents' => 25700,
                'vatable_sales_cents' => 15212,
                'vat_amount_cents' => 1825,
                'vat_exempt_sales_cents' => 8663,
                'payments' => [
                    ['method' => 'cash', 'amount_cents' => 15700, 'reference_no' => null],
                    ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => 'R-9'],
                ],
            ])
            ->and(array_column($data['refunds'][0]['items'], 'order_item_id'))->toBe([$this->hotDogLine, $this->riceLine, $this->teaLine]);

        expectReconciled();
    });

    it('lets a cashier refund with a manager\'s PIN, recording the approver', function () {
        $data = postRefund($this->token, $this->order['ulid'], exampleC([
            'authorization' => ['user_id' => $this->marco->id, 'pin' => '2468'],
        ]))->assertCreated()->json('data');

        expect($data['refunds'][0]['refunded_by'])->toBe(['id' => $this->carla->id, 'name' => 'Carla Cashier'])
            ->and($data['refunds'][0]['authorized_by'])->toBe(['id' => $this->marco->id, 'name' => 'Marco Manager'])
            ->and(lastAudit('order.refunded')->changes['authorized_by'])->toBe($this->marco->id);
    });

    it('counts on the refund\'s own business day and shift, from any tablet, with no time limit', function () {
        Carbon::setTestNow('2026-10-03 02:00:00'); // 10:00 in Manila, a week later
        $otherTablet = deviceToken($this->marco);
        $otherShift = openShift($otherTablet, $this->marco);

        $data = postRefund($otherTablet, $this->order['ulid'], exampleC(['shift_ulid' => $otherShift['ulid']]))
            ->assertCreated()
            ->json('data.refunds.0');

        expect($data['business_date'])->toBe('2026-10-03')
            ->and($data['shift_ulid'])->toBe($otherShift['ulid']);
    });

    it('accepts a shift the server doesn\'t know yet', function () {
        $unknown = newUlid();

        postRefund($this->marcoToken, $this->order['ulid'], exampleC(['shift_ulid' => $unknown]))
            ->assertCreated()
            ->assertJsonPath('data.refunds.0.shift_ulid', $unknown);
    });

    it('returns only the stock the sale took (track_stock at the time of sale)', function () {
        // Iced Tea stops tracking stock and Hot Dog starts after the sale.
        $this->icedTea->update(['track_stock' => false]);
        $this->hotDog->update(['track_stock' => true]);

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->hotDogLine, 1], [$this->teaLine, 1]], [
            ['method' => 'cash', 'amount_cents' => 6930 + 3369],
        ]))->assertCreated();

        expect(StockMovement::query()->where('type', 'refund')->pluck('product_id')->all())->toBe([$this->icedTea->id])
            ->and(stockOf($this->hotDog))->toBe(0);

        expectReconciled();
    });

    it('filters the list by status and shows refunded_cents on the summary', function () {
        postRefund($this->marcoToken, $this->order['ulid'], exampleC())->assertCreated();

        $this->withToken(tokenFor($this->marco))->getJson('/api/v1/orders?status=partially_refunded')
            ->assertOk()
            ->assertJsonPath('data.0.ulid', $this->order['ulid'])
            ->assertJsonPath('data.0.status', 'partially_refunded')
            ->assertJsonPath('data.0.refunded_cents', 3369);
    });
});

describe('idempotency', function () {
    it('replays the stored 201 for the same key and body, writing nothing twice', function () {
        $body = exampleC();
        $first = postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated();

        $again = postRefund($this->marcoToken, $this->order['ulid'], $body)
            ->assertCreated()
            ->assertHeader('Idempotency-Replayed', 'true');

        expect($again->json())->toBe($first->json())
            ->and(Refund::query()->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(48);
    });

    it('returns 409 for the same ulid with a different body', function () {
        $body = exampleC();
        postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated();

        postRefund($this->marcoToken, $this->order['ulid'], [...$body, 'reason' => 'Other'])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);
    });

    it('returns the order as it is for a refund ULID already recorded (a released key)', function () {
        $body = exampleC();
        postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated();
        DB::table('idempotency_keys')->delete();

        postRefund($this->marcoToken, $this->order['ulid'], $body)
            ->assertCreated()
            ->assertJsonPath('data.refunded_cents', 3369);

        expect(Refund::query()->count())->toBe(1);
    });

    it('returns 409 for the ULID of another order\'s refund', function () {
        $body = exampleC();
        postRefund($this->marcoToken, $this->order['ulid'], $body)->assertCreated();
        DB::table('idempotency_keys')->delete();

        $other = postOrder($this->carla, refundTestSale($this->shift['ulid']))->assertCreated()->json('data');

        postRefund($this->marcoToken, $other['ulid'], refundBody($this->shift['ulid'], [[$other['items'][2]['id'], 1]], [['method' => 'cash', 'amount_cents' => 3369]], ['ulid' => $body['ulid']]))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);
    });

    it('requires Idempotency-Key = ulid', function () {
        postRefund($this->marcoToken, $this->order['ulid'], exampleC(), newUlid())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['idempotency_key' => "The Idempotency-Key header must be a ULID that matches the request's ulid."]);
    });
});

describe('checks, in order', function () {
    it('returns 409 for a voided sale', function () {
        postVoid($this->marcoToken, $this->order['ulid'], voidBody())->assertOk();

        postRefund($this->marcoToken, $this->order['ulid'], exampleC())
            ->assertStatus(409)
            ->assertExactJson(['message' => "A voided sale can't be refunded."]);
    });

    it('returns 409 for a sale already fully refunded', function () {
        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->hotDogLine, 1], [$this->riceLine, 2], [$this->teaLine, 3]], [
            ['method' => 'cash', 'amount_cents' => 15700],
            ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => 'R-1'],
        ]))->assertCreated();

        postRefund($this->marcoToken, $this->order['ulid'], exampleC())
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This sale is already fully refunded.']);
    });

    it('reports every line above its remaining quantity', function () {
        postRefund($this->marcoToken, $this->order['ulid'], exampleC())->assertCreated();

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->hotDogLine, 1], [$this->riceLine, 3], [$this->teaLine, 3]], [
            ['method' => 'cash', 'amount_cents' => 1],
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'items.1.qty' => 'Only 2 left to refund.',
                'items.2.qty' => 'Only 2 left to refund.',
            ])
            ->assertJsonMissingValidationErrors(['items.0.qty', 'client_refund_cents', 'payments']);
    });

    it('returns 422 on client_refund_cents when the checksum is off, even by 1', function (int $client) {
        postRefund($this->marcoToken, $this->order['ulid'], exampleC(['client_refund_cents' => $client]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'The refund amount has changed. Review it.',
                'errors' => ['client_refund_cents' => ['The refund amount has changed. Review it.']],
            ]);

        expectNoRefundWritten();
    })->with([3368, 3370, 0]);

    it('returns 422 on payments when they don\'t add up to the amount', function (array $payments) {
        postRefund($this->marcoToken, $this->order['ulid'], exampleC(['payments' => $payments]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'The refund must add up to ₱33.69.',
                'errors' => ['payments' => ['The refund must add up to ₱33.69.']],
            ]);

        expectNoRefundWritten();
    })->with([
        'short' => [[['method' => 'cash', 'amount_cents' => 3000, 'reference_no' => null]]],
        'over' => [[['method' => 'cash', 'amount_cents' => 3000, 'reference_no' => null], ['method' => 'gcash', 'amount_cents' => 1000, 'reference_no' => 'G']]],
        'empty' => [[]],
    ]);

    it('limits each method to what it paid, net of change, minus earlier refunds', function () {
        // Cash paid 15700 (20000 tendered − 4300 change): Iced Tea + Rice Cake = 18770 is too much.
        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->riceLine, 2], [$this->teaLine, 3]], [
            ['method' => 'cash', 'amount_cents' => 18770],
        ]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'Only ₱157.00 paid by cash is left to refund.',
                'errors' => ['payments.0.amount_cents' => ['Only ₱157.00 paid by cash is left to refund.']],
            ]);

        // After 8663 of cash back, 7037 is left for cash; GCash paid 10000.
        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->riceLine, 2]], [
            ['method' => 'cash', 'amount_cents' => 8663],
        ]))->assertCreated();

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->hotDogLine, 1], [$this->teaLine, 3]], [
            ['method' => 'gcash', 'amount_cents' => 10100, 'reference_no' => 'G-1'],
            ['method' => 'cash', 'amount_cents' => 6937],
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['payments.0.amount_cents' => 'Only ₱100.00 paid by GCash is left to refund.'])
            ->assertJsonMissingValidationErrors(['payments.1.amount_cents']);

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->hotDogLine, 1], [$this->teaLine, 3]], [
            ['method' => 'cash', 'amount_cents' => 17037],
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['payments.0.amount_cents' => 'Only ₱70.37 paid by cash is left to refund.']);
    });

    it('returns 422 on shift_ulid for a closed shift of the branch', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 0))->assertOk();

        postRefund($this->marcoToken, $this->order['ulid'], exampleC())
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'This shift is closed. Open a new shift.',
                'errors' => ['shift_ulid' => ['This shift is closed. Open a new shift.']],
            ]);

        expectNoRefundWritten();
    });

    it('returns 409 for a shift of another tablet', function () {
        $otherTablet = deviceToken($this->marco);
        $otherShift = openShift($otherTablet, $this->marco);

        postRefund($this->marcoToken, $this->order['ulid'], exampleC(['shift_ulid' => $otherShift['ulid']]))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This shift belongs to another tablet.']);
    });

    it('checks the payments before the shift, and the shift before the approval', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 0))->assertOk();
        $wrongPin = ['authorization' => ['user_id' => $this->marco->id, 'pin' => '0000']];

        postRefund($this->token, $this->order['ulid'], exampleC([...$wrongPin, 'payments' => []]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['payments'])
            ->assertJsonMissingValidationErrors(['shift_ulid', 'authorization.pin']);

        postRefund($this->token, $this->order['ulid'], exampleC($wrongPin))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['shift_ulid'])
            ->assertJsonMissingValidationErrors(['authorization.pin']);
    });
});

describe('approval', function () {
    it('returns 422 on authorization when the caller lacks sale.refund and sends none', function () {
        postRefund($this->token, $this->order['ulid'], exampleC())
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'A manager must approve this refund.',
                'errors' => ['authorization' => ['A manager must approve this refund.']],
            ]);

        expectNoRefundWritten();
    });

    it('returns 422 on authorization.user_id for someone who can\'t approve refunds', function (Closure $approver) {
        postRefund($this->token, $this->order['ulid'], exampleC(['authorization' => ['user_id' => $approver()?->id ?? 999999, 'pin' => '2468']]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => "This person can't approve refunds.",
                'errors' => ['authorization.user_id' => ["This person can't approve refunds."]],
            ]);
    })->with([
        'a cashier' => [fn () => withPin(userWithRole('cashier'), '2468')],
        'without a PIN' => [fn () => userWithRole('manager')],
        'inactive' => [fn () => withPin(userWithRole('manager', ['is_active' => false]), '2468')],
        'another branch' => [fn () => withPin(User::factory()->forBranch(Branch::factory()->create())->withRole('manager')->create(), '2468')],
        'unknown' => [fn () => null],
        'sale.void without sale.refund' => [fn () => withPin(User::factory()->forBranch(test()->branch)->create([
            'role_id' => customRole('voider', ['sale.create', 'sale.void'])->id,
        ]), '2468')],
    ]);

    it('returns 422 on authorization.pin for a wrong PIN and locks after 5 (429)', function () {
        $wrong = exampleC(['authorization' => ['user_id' => $this->marco->id, 'pin' => '1111']]);

        for ($i = 0; $i < 5; $i++) {
            postRefund($this->token, $this->order['ulid'], $wrong)
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['authorization.pin' => 'Incorrect PIN.']);
        }

        postRefund($this->token, $this->order['ulid'], exampleC(['authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']]))
            ->assertStatus(429)
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 15 minutes.']);

        expectNoRefundWritten();
    });
});

describe('access and validation', function () {
    it('returns 401 without a token', function () {
        $body = exampleC();

        $this->flushHeaders()->postJson("/api/v1/orders/{$this->order['ulid']}/refunds", $body, ['Idempotency-Key' => $body['ulid']])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 403 without sale.create or sale.refund', function () {
        $viewer = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('viewer', ['report.view', 'sale.void'])->id]);

        postRefund(tokenFor($viewer), $this->order['ulid'], exampleC())
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 409 when the token is not bound to a tablet', function () {
        postRefund(tokenFor($this->marco), $this->order['ulid'], exampleC())
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);
    });

    it('returns 404 for an order the caller can\'t see', function (Closure $ulid) {
        postRefund($this->token, $ulid(), exampleC())
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    })->with([
        'unknown' => [fn () => newUlid()],
        'another cashier\'s (without report.view)' => [fn () => postOrder(test()->marco, refundTestSale(test()->shift['ulid']))->assertCreated()->json('data.ulid')],
        'another branch\'s' => [function () {
            $nick = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('owner')->create();

            return sell($nick, [[test()->hotDog, 1]], ['shift_ulid' => newUlid()])['ulid'];
        }],
    ]);

    it('returns 422 for a line of another order', function () {
        $other = postOrder($this->carla, refundTestSale($this->shift['ulid']))->assertCreated()->json('data');

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$other['items'][2]['id'], 1]], [['method' => 'cash', 'amount_cents' => 3369]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.order_item_id' => "This line isn't part of the sale."]);
    });

    it('validates the body', function (Closure $change, string $field, string $message) {
        postRefund($this->marcoToken, $this->order['ulid'], $change(exampleC()))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expectNoRefundWritten();
    })->with([
        'shift_ulid missing' => [fn (array $b) => [...$b, 'shift_ulid' => null], 'shift_ulid', 'The shift ulid field is required.'],
        'shift_ulid format' => [fn (array $b) => [...$b, 'shift_ulid' => 'nope'], 'shift_ulid', 'The shift ulid field format is invalid.'],
        'reason missing' => [fn (array $b) => [...$b, 'reason' => ''], 'reason', 'The reason field is required.'],
        'reason too long' => [fn (array $b) => [...$b, 'reason' => str_repeat('x', 256)], 'reason', 'The reason field must not be greater than 255 characters.'],
        'items missing' => [fn (array $b) => [...$b, 'items' => []], 'items', 'The items field is required.'],
        'too many items' => [fn (array $b) => [...$b, 'items' => array_fill(0, 101, ['order_item_id' => test()->teaLine, 'qty' => 1])], 'items', 'The items field must not have more than 100 items.'],
        'duplicate line' => [fn (array $b) => [...$b, 'items' => [['order_item_id' => test()->teaLine, 'qty' => 1], ['order_item_id' => test()->teaLine, 'qty' => 1]]], 'items.1.order_item_id', 'The items.1.order_item_id field has a duplicate value.'],
        'qty zero' => [fn (array $b) => [...$b, 'items' => [['order_item_id' => test()->teaLine, 'qty' => 0]]], 'items.0.qty', 'The items.0.qty field must be at least 1.'],
        'qty fraction' => [fn (array $b) => [...$b, 'items' => [['order_item_id' => test()->teaLine, 'qty' => 1.5]]], 'items.0.qty', 'The items.0.qty field must be an integer.'],
        'payments missing' => [fn (array $b) => array_diff_key($b, ['payments' => 1]), 'payments', 'The payments field is required.'],
        'three payments' => [fn (array $b) => [...$b, 'payments' => array_fill(0, 3, ['method' => 'cash', 'amount_cents' => 1, 'reference_no' => null])], 'payments', 'The payments field must not have more than 2 items.'],
        'two cash' => [fn (array $b) => [...$b, 'payments' => [['method' => 'cash', 'amount_cents' => 3000, 'reference_no' => null], ['method' => 'cash', 'amount_cents' => 369, 'reference_no' => null]]], 'payments.1.method', 'Only one cash payment is allowed.'],
        'two gcash' => [fn (array $b) => [...$b, 'payments' => [['method' => 'gcash', 'amount_cents' => 3000, 'reference_no' => 'A'], ['method' => 'gcash', 'amount_cents' => 369, 'reference_no' => 'B']]], 'payments.1.method', 'Only one GCash payment is allowed.'],
        'unknown method' => [fn (array $b) => [...$b, 'payments' => [['method' => 'card', 'amount_cents' => 3369, 'reference_no' => null]]], 'payments.0.method', 'The selected payments.0.method is invalid.'],
        'amount zero' => [fn (array $b) => [...$b, 'payments' => [['method' => 'cash', 'amount_cents' => 0, 'reference_no' => null]]], 'payments.0.amount_cents', 'The payments.0.amount_cents field must be at least 1.'],
        'amount as string' => [fn (array $b) => [...$b, 'payments' => [['method' => 'cash', 'amount_cents' => '3369', 'reference_no' => null]]], 'payments.0.amount_cents', 'The payments.0.amount_cents field must be an integer.'],
        'gcash without reference' => [fn (array $b) => [...$b, 'payments' => [['method' => 'gcash', 'amount_cents' => 3369, 'reference_no' => null]]], 'payments.0.reference_no', 'The payments.0.reference_no field is required when payments.0.method is gcash.'],
        'cash with reference' => [fn (array $b) => [...$b, 'payments' => [['method' => 'cash', 'amount_cents' => 3369, 'reference_no' => 'X']]], 'payments.0.reference_no', 'The payments.0.reference_no field is prohibited when payments.0.method is cash.'],
        'reference format' => [fn (array $b) => [...$b, 'payments' => [['method' => 'gcash', 'amount_cents' => 3369, 'reference_no' => 'a b']]], 'payments.0.reference_no', 'The payments.0.reference_no field format is invalid.'],
        'client_refund_cents missing' => [fn (array $b) => array_diff_key($b, ['client_refund_cents' => 1]), 'client_refund_cents', 'The client refund cents field is required.'],
        'client_refund_cents negative' => [fn (array $b) => [...$b, 'client_refund_cents' => -1], 'client_refund_cents', 'The client refund cents field must be at least 0.'],
        'pin format' => [fn (array $b) => [...$b, 'authorization' => ['user_id' => 1, 'pin' => '12']], 'authorization.pin', 'The authorization.pin field format is invalid.'],
    ]);
});
