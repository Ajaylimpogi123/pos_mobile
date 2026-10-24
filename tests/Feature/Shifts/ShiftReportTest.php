<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-26.
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = userWithRole('manager', ['name' => 'Marco Manager']);

    $menu = Category::factory()->create(['name' => 'Menu']);
    $this->meal = Product::factory()->forCategory($menu)->create(['name' => 'Fried Chicken', 'price_cents' => 10000]);
    $this->cake = Product::factory()->forCategory($menu)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'is_vatable' => false]);
    $this->tea = Product::factory()->forCategory($menu)->create(['name' => 'Iced Tea', 'price_cents' => 3500]);

    $this->token = deviceToken($this->carla);
    $this->shift = openShift($this->token, $this->carla, ['opened_at' => '2026-09-26T03:00:00Z', 'opening_float_cents' => 200000]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * The shift's report, read by a manager (report.zread).
 *
 * @return array<string, mixed>
 */
function shiftReport(string $ulid): array
{
    return test()->withToken(tokenFor(test()->marco))->getJson("/api/v1/shifts/{$ulid}")->assertOk()->json('data.report');
}

/**
 * Three sales into the shift:
 * 1. Carla: meal + 2 tea = 17000 (VAT 1821), cash 20000 → change 3000.
 * 2. Marco: 2 cake = 9000 − 10% = 8100, VAT-exempt, GCash.
 * 3. Carla: meal = 10000 (VAT 1071), GCash 4000 + cash 10000 → change 4000.
 */
function threeShiftSales(): void
{
    $shift = test()->shift['ulid'];

    sell(test()->carla, [[test()->meal, 1], [test()->tea, 2]], [
        'shift_ulid' => $shift,
        'payments' => [['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null]],
    ]);
    sell(test()->marco, [[test()->cake, 2]], [
        'shift_ulid' => $shift,
        'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000],
        'client_total_cents' => 8100,
        'payments' => [['method' => 'gcash', 'amount_cents' => 8100, 'reference_no' => 'G-1']],
    ]);
    sell(test()->carla, [[test()->meal, 1]], [
        'shift_ulid' => $shift,
        'payments' => [
            ['method' => 'gcash', 'amount_cents' => 4000, 'reference_no' => 'G-2'],
            ['method' => 'cash', 'amount_cents' => 10000, 'reference_no' => null],
        ],
    ]);
}

it('computes the sales, the change-netted cash, cash in and out, expected cash and the variance', function () {
    threeShiftSales();
    $ulid = $this->shift['ulid'];

    postCashMovement($this->token, $ulid, cashMovementBody($this->carla, ['type' => 'in', 'amount_cents' => 50000]))->assertCreated();
    postCashMovement($this->token, $ulid, cashMovementBody($this->carla, ['type' => 'out', 'amount_cents' => 10500]))->assertCreated();
    postCashMovement($this->token, $ulid, cashMovementBody($this->marco, ['type' => 'out', 'amount_cents' => 5000]))->assertCreated();

    $expected = [
        'orders_count' => 3,
        'items_sold' => 6,
        'gross_sales_cents' => 36000,
        'discounts_cents' => 900,
        'net_sales_cents' => 35100,
        'vatable_sales_cents' => 24108,
        'vat_amount_cents' => 2892,
        'vat_exempt_sales_cents' => 8100,
        ...noScPwdFigures(),
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 2, 'amount_cents' => 23000], // 17000 + (10000 − 4000 change)
            ['method' => 'gcash', 'orders_count' => 2, 'amount_cents' => 12100],
        ],
        ...noShiftReversals(35100),
        'cash_in_cents' => 50000,
        'cash_out_cents' => 15500,
        'expected_cash_cents' => 257500, // 200000 + 23000 + 50000 − 15500
        'variance_cents' => null, // open: X-read
        'by_cashier' => [
            ['user_id' => $this->carla->id, 'name' => 'Carla Cashier', 'orders_count' => 2, 'net_sales_cents' => 27000],
            ['user_id' => $this->marco->id, 'name' => 'Marco Manager', 'orders_count' => 1, 'net_sales_cents' => 8100],
        ],
        'needs_review_count' => 0,
    ];

    expect(shiftReport($ulid))->toBe($expected);

    // Z-read: ₱5.00 short.
    $closed = postClose($this->token, $ulid, closeBody($this->carla, 257000))->assertOk()->json('data.report');

    expect($closed)->toBe([...$expected, 'variance_cents' => -500]);

    // Over is positive.
    Carbon::setTestNow('2026-09-26 05:00:00');
    $next = openShift($this->token, $this->carla, ['opening_float_cents' => 1000]);
    expect(postClose($this->token, $next['ulid'], closeBody($this->carla, 1250))->assertOk()->json('data.report.variance_cents'))->toBe(250);
});

it('orders by_cashier by net sales, then name', function () {
    $alma = userWithRole('cashier', ['name' => 'Alma Cashier']);
    $shift = $this->shift['ulid'];

    sell($this->carla, [[$this->tea, 1]], ['shift_ulid' => $shift]);
    sell($alma, [[$this->tea, 1]], ['shift_ulid' => $shift]);
    sell($this->marco, [[$this->meal, 1]], ['shift_ulid' => $shift]);

    expect(array_column(shiftReport($shift)['by_cashier'], 'name'))->toBe(['Marco Manager', 'Alma Cashier', 'Carla Cashier']);
});

it('counts only the shift\'s completed orders of its own branch', function () {
    threeShiftSales();

    // Another shift of the branch.
    sell($this->carla, [[$this->meal, 5]], ['shift_ulid' => newUlid()]);

    // Another branch's sale carrying this ULID (the branch doesn't know the shift, so it is accepted).
    $north = Branch::factory()->create(['code' => 'NORTH']);
    $nick = User::factory()->forBranch($north)->withRole('cashier')->create();
    sell($nick, [[$this->meal, 3]], ['shift_ulid' => $this->shift['ulid']]);

    // A sale that is no longer completed (voids arrive in Phase 7).
    $voided = sell($this->carla, [[$this->meal, 7]], ['shift_ulid' => $this->shift['ulid']]);
    DB::table('orders')->where('ulid', $voided['ulid'])->update(['status' => 'voided']);

    expect(shiftReport($this->shift['ulid']))->toMatchArray(['orders_count' => 3, 'net_sales_cents' => 35100]);
});

it('counts the shift\'s orders flagged for review, live', function () {
    $offline = offlineOrder($this->carla, [[$this->tea, 1]], [
        'shift_ulid' => $this->shift['ulid'],
        'items' => [['product_id' => $this->tea->id, 'qty' => 1, 'unit_price_cents' => 3000, 'discount' => null, 'notes' => null]],
        'client_total_cents' => 3000,
        'payments' => [['method' => 'cash', 'amount_cents' => 3000, 'reference_no' => null]],
    ]);
    expect(syncOrders($this->token, [$offline])->assertOk()->json('data.0.order.review_reasons'))->toBe(['price_changed']);
    sell($this->carla, [[$this->tea, 1]], ['shift_ulid' => $this->shift['ulid']]);

    expect(shiftReport($this->shift['ulid']))->toMatchArray(['orders_count' => 2, 'needs_review_count' => 1]);

    $this->withToken(tokenFor($this->marco))->postJson("/api/v1/orders/{$offline['ulid']}/review", ['note' => 'OK'])->assertOk();

    expect(shiftReport($this->shift['ulid'])['needs_review_count'])->toBe(0);
});

it('keeps counting what reaches the server after the close (Q-012)', function () {
    postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 200000))->assertOk();

    // A sale rung up before the close, synced after it.
    syncOrders($this->token, [offlineOrder($this->carla, [[$this->meal, 1]], [
        'shift_ulid' => $this->shift['ulid'],
        'placed_at' => '2026-09-26T03:30:00Z',
    ])])->assertOk()->assertJsonPath('data.0.status', 'accepted');

    expect(shiftReport($this->shift['ulid']))->toMatchArray([
        'orders_count' => 1,
        'expected_cash_cents' => 210000,
        'variance_cents' => -10000,
    ]);
});

describe('orders and their shift', function () {
    it('stores and returns the shift on an online sale, for a known open shift or an unknown one', function (bool $known) {
        $ulid = $known ? $this->shift['ulid'] : newUlid();

        $data = sell($this->carla, [[$this->tea, 1]], ['shift_ulid' => $ulid]);

        expect($data['shift_ulid'])->toBe($ulid)
            ->and(Order::query()->sole()->shift_ulid)->toBe($ulid);

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/orders')
            ->assertOk()
            ->assertJsonPath('data.0.shift_ulid', $ulid);
    })->with(['known and open' => [true], 'unknown to the server' => [false]]);

    it('returns 422 on shift_ulid for a closed shift, writing nothing', function () {
        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 200000))->assertOk();

        postOrder($this->carla, simpleSale([[$this->tea, 1]], ['shift_ulid' => $this->shift['ulid']]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['shift_ulid' => 'This shift is closed. Open a new shift.']);

        expect(Order::query()->count())->toBe(0);
    });

    it('still replays a sale completed before its shift closed', function () {
        $payload = simpleSale([[$this->tea, 1]], ['shift_ulid' => $this->shift['ulid']]);
        postOrder($this->carla, $payload)->assertCreated();

        postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 200000))->assertOk();

        postOrder($this->carla, $payload)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
    });

    it('accepts the ULID of another branch\'s closed shift (unknown to the caller\'s branch)', function () {
        $nick = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();
        $nickToken = deviceToken($nick);
        $theirs = openShift($nickToken, $nick);
        postClose($nickToken, $theirs['ulid'], closeBody($nick, 0))->assertOk();

        sell($this->carla, [[$this->tea, 1]], ['shift_ulid' => $theirs['ulid']]);
    });

    it('validates shift_ulid on online sales', function (mixed $value, string $message) {
        postOrder($this->carla, simpleSale([[$this->tea, 1]], ['shift_ulid' => $value]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['shift_ulid' => $message]);
    })->with([
        'missing' => [null, 'The shift ulid field is required.'],
        'lowercase' => [strtolower(newUlid()), 'The shift ulid field format is invalid.'],
        'not a string' => [123, 'The shift ulid field must be a string.'],
    ]);

    describe('offline ingest', function () {
        it('flags shift_closed when the shift was closed before the sale, and still accepts it', function () {
            postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 200000, ['closed_at' => '2026-09-26T03:20:00Z']))->assertOk();

            $result = syncOrders($this->token, [offlineOrder($this->carla, [[$this->tea, 1]], [
                'shift_ulid' => $this->shift['ulid'],
                'placed_at' => '2026-09-26T03:30:00Z',
            ])])->assertOk()->json('data.0');

            expect($result['status'])->toBe('accepted')
                ->and($result['order']['needs_review'])->toBeTrue()
                ->and($result['order']['review_reasons'])->toBe(['shift_closed'])
                ->and($result['order']['shift_ulid'])->toBe($this->shift['ulid']);
        });

        it('puts shift_closed last among the reasons', function () {
            postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 200000, ['closed_at' => '2026-09-26T03:20:00Z']))->assertOk();

            $order = offlineOrder($this->carla, [[$this->tea, 1]], [
                'shift_ulid' => $this->shift['ulid'],
                'placed_at' => '2026-09-26T04:30:00Z', // 30 min ahead of the server: clamped to now, flagged clock_skew
                'items' => [['product_id' => $this->tea->id, 'qty' => 1, 'unit_price_cents' => 3000, 'discount' => null, 'notes' => null]],
                'client_total_cents' => 3000,
                'payments' => [['method' => 'cash', 'amount_cents' => 3000, 'reference_no' => null]],
            ]);

            expect(syncOrders($this->token, [$order])->assertOk()->json('data.0.order.review_reasons'))
                ->toBe(['price_changed', 'clock_skew', 'shift_closed']);
        });

        it('does not flag a sale placed before the close, an open shift, or an unknown one', function (Closure $shiftUlid, string $placedAt) {
            postClose($this->token, $this->shift['ulid'], closeBody($this->carla, 200000, ['closed_at' => '2026-09-26T03:20:00Z']))->assertOk();

            $result = syncOrders($this->token, [offlineOrder($this->carla, [[$this->tea, 1]], [
                'shift_ulid' => $shiftUlid(),
                'placed_at' => $placedAt,
            ])])->assertOk()->json('data.0');

            expect($result['status'])->toBe('accepted')
                ->and($result['order']['review_reasons'])->toBe([]);
        })->with([
            'placed before the close' => [fn () => test()->shift['ulid'], '2026-09-26T03:10:00Z'],
            'placed at the close' => [fn () => test()->shift['ulid'], '2026-09-26T03:20:00Z'],
            'open shift' => [fn () => openShift(deviceToken(test()->carla, newUlid()), test()->carla)['ulid'], '2026-09-26T03:30:00Z'],
            'unknown shift' => [fn () => newUlid(), '2026-09-26T03:30:00Z'],
        ]);

        it('rejects an offline sale without a valid shift_ulid', function (mixed $value, string $message) {
            $result = syncOrders($this->token, [offlineOrder($this->carla, [[$this->tea, 1]], ['shift_ulid' => $value])])
                ->assertOk()
                ->json('data.0');

            expect($result['status'])->toBe('rejected')
                ->and($result['message'])->toBe($message);
        })->with([
            'missing' => [null, 'The shift ulid field is required.'],
            'malformed' => ['SHIFT-1', 'The shift ulid field format is invalid.'],
        ]);

        it('looks up the batch\'s shifts once, not once per order', function () {
            $countShiftQueries = function (int $orders): int {
                $batch = array_map(fn () => offlineOrder($this->carla, [[$this->tea, 1]], [
                    'shift_ulid' => $this->shift['ulid'],
                ]), range(1, $orders));

                $sql = [];
                DB::listen(function ($query) use (&$sql) {
                    $sql[] = $query->sql;
                });

                syncOrders($this->token, $batch)->assertOk();

                return count(array_filter($sql, fn (string $s) => str_contains($s, 'from '.DB::getQueryGrammar()->wrapTable('shifts'))));
            };

            expect($countShiftQueries(1))->toBe(1)
                ->and($countShiftQueries(20))->toBe(1);
        });
    });
});
