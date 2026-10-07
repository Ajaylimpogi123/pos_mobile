<?php

use App\Actions\Audit\RecordAuditLog;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Device;
use App\Models\Order;
use App\Models\PersonalAccessToken;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-26.
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);

    $this->breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);

    $this->hotDog = Product::factory()->forCategory($this->breakfast)->create([
        'name' => 'Hot Dog', 'sku' => 'BRK-002', 'price_cents' => 8000, 'cost_cents' => 3600,
    ]);
    $this->riceCake = Product::factory()->forCategory($this->breakfast)->create([
        'name' => 'Rice Cake', 'sku' => null, 'price_cents' => 4500, 'cost_cents' => 2000, 'is_vatable' => false,
    ]);
    $this->icedTea = Product::factory()->forCategory($this->drinks)->create([
        'name' => 'Iced Tea', 'sku' => 'DRK-001', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true,
    ]);
    stockUp($this->icedTea, 50);

    $this->token = deviceToken($this->cashier);
    $this->device = Device::query()->sole();
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Sync one order with the cashier's device token and return its result.
 *
 * @return array<string, mixed>
 */
function syncOne(mixed $order, ?string $token = null): array
{
    $response = syncOrders($token ?? test()->token, [$order])->assertOk();

    expect($response->json('data'))->toHaveCount(1);

    return $response->json('data.0');
}

/**
 * The review reasons of a synced order, asserting it was accepted.
 *
 * @return list<string>
 */
function reasonsOf(array $order, ?string $token = null): array
{
    $result = syncOne($order, $token);

    expect($result['status'])->toBe('accepted')
        ->and($result['order']['needs_review'])->toBe($result['order']['review_reasons'] !== []);

    return $result['order']['review_reasons'];
}

describe('accepted', function () {
    it('stores a clean offline sale with its device number, the given time and source offline', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 1], [$this->icedTea, 2]], [
            'order_no' => 'T01-20260926-0005',
            'table_no' => ' 7 ',
            'notes' => 'Offline',
        ]);

        $response = syncOrders($this->token, [$order])->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data.0')))->toBe(['ulid', 'status', 'order', 'message'])
            ->and(array_keys($response->json('data.0.order')))->toBe(orderKeys());

        $response->assertJsonPath('data.0.ulid', $order['ulid'])
            ->assertJsonPath('data.0.status', 'accepted')
            ->assertJsonPath('data.0.message', null);

        $data = $response->json('data.0.order');

        expect($data)->toMatchArray([
            'ulid' => $order['ulid'],
            'invoice_no' => 'INV-MAIN-00000001',
            'order_no' => 'T01-20260926-0005',
            'queue_no' => 1,
            'table_no' => '7',
            'business_date' => '2026-09-26',
            'status' => 'completed',
            'placed_at' => '2026-09-26T03:30:00Z',
            'cashier' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
            'authorized_by' => null,
            'customer' => null,
            'notes' => 'Offline',
            'subtotal_cents' => 15000,
            'discount_cents' => 0,
            'total_cents' => 15000,
            'vatable_sales_cents' => 13393,
            'vat_amount_cents' => 1607,
            'vat_exempt_sales_cents' => 0,
            'tendered_cents' => 15000,
            'change_cents' => 0,
            'client_total_cents' => 15000,
            'has_total_mismatch' => false,
            'source' => 'offline',
            'needs_review' => false,
            'review_reasons' => [],
            'reviewed_at' => null,
            'reviewed_by' => null,
            'synced_at' => '2026-09-26T04:00:00Z',
        ])
            ->and($data['items'][0])->toMatchArray([
                'product_id' => $this->hotDog->id, 'product_name' => 'Hot Dog', 'category_id' => $this->breakfast->id,
                'category_name' => 'Breakfast', 'sku' => 'BRK-002', 'qty' => 1, 'unit_price_cents' => 8000,
                'line_total_cents' => 8000,
            ])
            ->and($data['payments'])->toBe([
                ['method' => 'cash', 'amount_cents' => 15000, 'tendered_cents' => 15000, 'change_cents' => 0, 'reference_no' => null],
            ]);

        $stored = Order::query()->sole();

        expect($stored->device_id)->toBe($this->device->id)
            ->and($stored->user_id)->toBe($this->cashier->id)
            ->and($stored->source)->toBe('offline')
            ->and($stored->items()->pluck('unit_cost_cents')->all())->toBe([3600, 1575]);
    });

    it('depletes stock with one sale movement at the sale time, and audits order.completed with source offline', function () {
        $order = offlineOrder($this->cashier, [[$this->icedTea, 2], [$this->icedTea, 1]]);

        syncOne($order);

        $stored = Order::query()->sole();
        $movement = StockMovement::query()->where('type', 'sale')->sole();

        expect(stockOf($this->icedTea))->toBe(47)
            ->and((int) $movement->qty_delta)->toBe(-3)
            ->and($movement->reference_id)->toBe($stored->id)
            ->and($movement->created_by)->toBe($this->cashier->id)
            ->and($movement->occurred_at->toIso8601ZuluString())->toBe('2026-09-26T03:30:00Z');

        $audit = lastAudit('order.completed');

        expect($audit->actor_id)->toBe($this->cashier->id)
            ->and($audit->subject_id)->toBe($stored->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'invoice_no' => 'INV-MAIN-00000001', 'total_cents' => 10500, 'authorized_by' => null, 'source' => 'offline', 'sc_pwd' => null,
            ]));
    });

    it('records the cashier from the payload, not the syncing user', function () {
        $this->app['auth']->forgetGuards();
        $managerToken = deviceToken($this->manager);

        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]]), $managerToken);

        expect($result['order']['cashier'])->toBe(['id' => $this->cashier->id, 'name' => 'Carla Cashier'])
            ->and(Order::query()->sole()->user_id)->toBe($this->cashier->id);
    });

    it('accepts placed_at with milliseconds or an offset, stored in UTC to the second', function (string $placedAt, string $expected) {
        expect(syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['placed_at' => $placedAt]))['order']['placed_at'])
            ->toBe($expected);
    })->with([
        'milliseconds' => ['2026-09-26T03:15:00.123Z', '2026-09-26T03:15:00Z'],
        'offset' => ['2026-09-26T11:15:00+08:00', '2026-09-26T03:15:00Z'],
    ]);

    it('allocates the invoice number at ingest, after the online sales', function () {
        sell($this->cashier, [[$this->hotDog, 1]]);

        expect(syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]]))['order']['invoice_no'])->toBe('INV-MAIN-00000002');
    });

    it('accepts a soft-deleted customer', function () {
        $maria = Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos']);
        $maria->delete();

        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['customer_id' => $maria->id]));

        expect($result['status'])->toBe('accepted')
            ->and($result['order']['customer'])->toBe(['id' => $maria->id, 'full_name' => 'Maria Santos']);
    });

    it('stores the change of an overpaid cash sale with the Phase 3 rules', function () {
        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], [
            'payments' => [
                ['method' => 'gcash', 'amount_cents' => 3000, 'reference_no' => 'G-1'],
                ['method' => 'cash', 'amount_cents' => 10000, 'reference_no' => null],
            ],
        ]));

        expect($result['order']['needs_review'])->toBeFalse()
            ->and($result['order']['tendered_cents'])->toBe(13000)
            ->and($result['order']['change_cents'])->toBe(5000)
            ->and($result['order']['payments'])->toBe([
                ['method' => 'gcash', 'amount_cents' => 3000, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'G-1'],
                ['method' => 'cash', 'amount_cents' => 5000, 'tendered_cents' => 10000, 'change_cents' => 5000, 'reference_no' => null],
            ]);
    });

    it('applies the order and line discounts like the online path (worked example B)', function () {
        $order = offlineOrder($this->manager, [[$this->hotDog, 1], [$this->riceCake, 2], [$this->icedTea, 3]], [
            'discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 1000],
            'payments' => [
                ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => '1012345678901'],
                ['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null],
            ],
            'client_total_cents' => 25700,
        ]);
        $order['items'][0]['discount'] = ['type' => 'promo', 'kind' => 'percent', 'value' => 1000];

        $data = syncOne($order)['order'];

        expect($data)->toMatchArray([
            'subtotal_cents' => 27500, 'line_discounts_cents' => 800, 'discount_cents' => 1800, 'total_cents' => 25700,
            'vatable_sales_cents' => 15212, 'vat_amount_cents' => 1825, 'vat_exempt_sales_cents' => 8663,
            'tendered_cents' => 30000, 'change_cents' => 4300, 'needs_review' => false,
        ])
            ->and(array_column($data['items'], 'line_total_cents'))->toBe([6930, 8663, 10107]);
    });
});

describe('review flags', function () {
    it('keeps the snapshot price when the price changed during the outage, and flags price_changed', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 2]]);
        $this->hotDog->update(['price_cents' => 9000]);

        $result = syncOne($order);

        expect($result['order']['review_reasons'])->toBe(['price_changed'])
            ->and($result['order']['needs_review'])->toBeTrue()
            ->and($result['order']['items'][0]['unit_price_cents'])->toBe(8000)
            ->and($result['order']['total_cents'])->toBe(16000)
            ->and($result['order']['has_total_mismatch'])->toBeFalse();
    });

    it('flags price_changed when the product or its category left the menu, keeping the snapshots', function (Closure $change) {
        $order = offlineOrder($this->cashier, [[$this->riceCake, 1]]);
        $change($this->riceCake, $this->breakfast);

        $result = syncOne($order);

        expect($result['status'])->toBe('accepted')
            ->and($result['order']['review_reasons'])->toBe(['price_changed'])
            ->and($result['order']['items'][0])->toMatchArray([
                'product_id' => $this->riceCake->id, 'product_name' => 'Rice Cake', 'category_name' => 'Breakfast',
                'unit_price_cents' => 4500, 'is_vatable' => false,
            ]);
    })->with([
        'product deleted' => [fn (Product $product) => $product->delete()],
        'product unavailable' => [fn (Product $product) => $product->update(['is_available' => false])],
        'category inactive' => [fn (Product $product, Category $category) => $category->update(['is_active' => false])],
        'category deleted' => [fn (Product $product, Category $category) => $category->delete()],
    ]);

    it('applies stock even below zero and flags oversold', function () {
        $result = syncOne(offlineOrder($this->cashier, [[$this->icedTea, 30], [$this->icedTea, 22]]));

        expect($result['order']['review_reasons'])->toBe(['oversold'])
            ->and(stockOf($this->icedTea))->toBe(-2)
            ->and((int) StockMovement::query()->where('type', 'sale')->sole()->qty_delta)->toBe(-52);
    });

    it('does not flag a sale that takes the stock to exactly zero', function () {
        expect(reasonsOf(offlineOrder($this->cashier, [[$this->icedTea, 50]])))->toBe([])
            ->and(stockOf($this->icedTea))->toBe(0);
    });

    it('creates a missing stock level and flags oversold', function () {
        $water = Product::factory()->forCategory($this->drinks)->create(['price_cents' => 2000, 'track_stock' => true]);

        expect(reasonsOf(offlineOrder($this->cashier, [[$water, 3]])))->toBe(['oversold'])
            ->and(stockOf($water))->toBe(-3);
    });

    it('flags oversold again while the level stays negative', function () {
        syncOne(offlineOrder($this->cashier, [[$this->icedTea, 51]]));

        expect(reasonsOf(offlineOrder($this->cashier, [[$this->icedTea, 1]])))->toBe(['oversold'])
            ->and(stockOf($this->icedTea))->toBe(-2);
    });

    it('flags total_mismatch above 1 centavo, and only records a 1-centavo difference', function (int $difference, array $reasons) {
        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['client_total_cents' => 8000 + $difference]));

        expect($result['order']['review_reasons'])->toBe($reasons)
            ->and($result['order']['has_total_mismatch'])->toBeTrue()
            ->and($result['order']['total_cents'])->toBe(8000)
            ->and($result['order']['client_total_cents'])->toBe(8000 + $difference);
    })->with([
        '+2' => [2, ['total_mismatch']],
        '-500' => [-500, ['total_mismatch']],
        '+1' => [1, []],
        '-1' => [-1, []],
    ]);

    it('stores short payments as tendered with change 0, and flags payment_short', function () {
        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], [
            'payments' => [
                ['method' => 'gcash', 'amount_cents' => 2000, 'reference_no' => 'G-1'],
                ['method' => 'cash', 'amount_cents' => 5000, 'reference_no' => null],
            ],
        ]));

        expect($result['order']['review_reasons'])->toBe(['payment_short'])
            ->and($result['order']['tendered_cents'])->toBe(7000)
            ->and($result['order']['change_cents'])->toBe(0)
            ->and($result['order']['payments'])->toBe([
                ['method' => 'gcash', 'amount_cents' => 2000, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'G-1'],
                ['method' => 'cash', 'amount_cents' => 5000, 'tendered_cents' => 5000, 'change_cents' => 0, 'reference_no' => null],
            ]);
    });

    it('flags payment_short for a sale with no payments', function () {
        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['payments' => []]));

        expect($result['order']['review_reasons'])->toBe(['payment_short'])
            ->and($result['order']['payments'])->toBe([])
            ->and($result['order']['tendered_cents'])->toBe(0);
    });

    it('stores GCash above the total as tendered, provisionally without a flag (Q-008)', function () {
        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], [
            'payments' => [['method' => 'gcash', 'amount_cents' => 9000, 'reference_no' => 'G-1']],
        ]));

        expect($result['status'])->toBe('accepted')
            ->and($result['order']['review_reasons'])->toBe([])
            ->and($result['order']['change_cents'])->toBe(0)
            ->and($result['order']['payments'])->toBe([
                ['method' => 'gcash', 'amount_cents' => 9000, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'G-1'],
            ]);
    });

    it('flags discount_over_limit when the cashier would have needed approval, with no approver', function (string $who, int $percentBps, array $reasons) {
        $cashier = $who === 'cashier' ? $this->cashier : $this->manager;
        $total = 8000 - intdiv(8000 * $percentBps, 10000);

        $result = syncOne(offlineOrder($cashier, [[$this->hotDog, 1]], [
            'discount' => ['type' => 'manual', 'kind' => 'percent', 'value' => $percentBps],
            'payments' => [['method' => 'cash', 'amount_cents' => $total, 'reference_no' => null]],
            'client_total_cents' => $total,
        ]));

        expect($result['order']['review_reasons'])->toBe($reasons)
            ->and($result['order']['authorized_by'])->toBeNull()
            ->and($result['order']['total_cents'])->toBe($total);
    })->with([
        'cashier above 10%' => ['cashier', 2000, ['discount_over_limit']],
        'cashier at 10%' => ['cashier', 1000, []],
        'manager at 20%' => ['manager', 2000, []],
    ]);

    it('flags discount_over_limit for a cashier without discount.apply', function () {
        $role = customRole('seller', ['sale.create'], 50);
        $seller = User::factory()->forBranch($this->branch)->create(['role_id' => $role->id]);

        expect(reasonsOf(offlineOrder($seller, [[$this->hotDog, 1]], [
            'discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 100],
            'payments' => [['method' => 'cash', 'amount_cents' => 7900, 'reference_no' => null]],
            'client_total_cents' => 7900,
        ])))->toBe(['discount_over_limit']);
    });

    it('clamps a future placed_at to now, flagging clock_skew only beyond 5 minutes', function (int $secondsAhead, array $reasons) {
        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], [
            'placed_at' => now()->addSeconds($secondsAhead)->toIso8601ZuluString(),
        ]));

        expect($result['order']['placed_at'])->toBe('2026-09-26T04:00:00Z')
            ->and($result['order']['review_reasons'])->toBe($reasons);
    })->with([
        '10 minutes' => [600, ['clock_skew']],
        '5 minutes 1 second' => [301, ['clock_skew']],
        'exactly 5 minutes' => [300, []],
        '1 minute' => [60, []],
    ]);

    it('stores every reason that applies, in the fixed order', function () {
        $order = offlineOrder($this->cashier, [[$this->icedTea, 51]], [
            'placed_at' => now()->addMinutes(10)->toIso8601ZuluString(),
            'discount' => ['type' => 'manual', 'kind' => 'percent', 'value' => 2000],
            'payments' => [['method' => 'cash', 'amount_cents' => 1000, 'reference_no' => null]],
            'client_total_cents' => 100000,
        ]);
        $order['items'][0]['unit_price_cents'] = 3000;

        $result = syncOne($order);

        expect($result['order']['review_reasons'])->toBe([
            'price_changed', 'oversold', 'total_mismatch', 'payment_short', 'discount_over_limit', 'clock_skew',
        ])
            ->and($result['order']['total_cents'])->toBe(122400)
            ->and(Order::query()->sole()->review_reasons)->toBe($result['order']['review_reasons']);
    });

    it('combines price_changed and oversold', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 1], [$this->icedTea, 60]]);
        $this->hotDog->update(['price_cents' => 8500]);

        expect(reasonsOf($order))->toBe(['price_changed', 'oversold']);
    });
});

describe('numbers and business day', function () {
    it('takes business_date and queue_no from the business day of placed_at (the previous day)', function () {
        Carbon::setTestNow('2026-09-25 04:00:00');
        sell($this->cashier, [[$this->hotDog, 1]]); // 2026-09-25, queue 1, INV 1
        Carbon::setTestNow('2026-09-26 04:00:00');
        sell($this->cashier, [[$this->hotDog, 1]]); // 2026-09-26, queue 1, INV 2

        $yesterday = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['placed_at' => '2026-09-25T10:00:00Z']))['order'];
        $today = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]]))['order'];

        expect([$yesterday['business_date'], $yesterday['queue_no'], $yesterday['invoice_no']])
            ->toBe(['2026-09-25', 2, 'INV-MAIN-00000003'])
            ->and([$today['business_date'], $today['queue_no'], $today['invoice_no']])
            ->toBe(['2026-09-26', 2, 'INV-MAIN-00000004']);
    });

    it('rolls the business day over at the branch day start (04:00 Manila)', function (string $placedAt, string $businessDate) {
        expect(syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['placed_at' => $placedAt]))['order']['business_date'])
            ->toBe($businessDate);
    })->with([
        '03:59:59 Manila' => ['2026-09-25T19:59:59Z', '2026-09-25'],
        '04:00:00 Manila' => ['2026-09-25T20:00:00Z', '2026-09-26'],
    ]);

    it('keeps order_no unique per device in the database', function () {
        syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['order_no' => 'T01-20260926-0001']));
        $order = Order::query()->sole();

        expect(fn () => DB::table('orders')->insert([
            ...collect($order->getAttributes())->except(['id', 'ulid', 'invoice_no'])->all(),
            'ulid' => newUlid(),
            'invoice_no' => 'INV-MAIN-99999999',
        ]))->toThrow(UniqueConstraintViolationException::class);
    });

    it('defaults a row written without the Phase 5 columns to an online, unflagged order (the backfill)', function () {
        sell($this->cashier, [[$this->hotDog, 1]]);
        $row = collect((array) DB::table('orders')->first())
            ->except(['id', 'ulid', 'invoice_no', 'device_id', 'order_no', 'source', 'needs_review', 'review_reasons', 'reviewed_at', 'reviewed_by', 'synced_at'])
            ->all();

        DB::table('orders')->insert([...$row, 'ulid' => newUlid(), 'invoice_no' => 'INV-MAIN-00000099']);
        $order = Order::query()->where('invoice_no', 'INV-MAIN-00000099')->sole();

        expect($order->source)->toBe('online')
            ->and($order->needs_review)->toBeFalse()
            ->and($order->review_reasons)->toBe([])
            ->and($order->device_id)->toBeNull()
            ->and($order->order_no)->toBeNull();
    });

    it('accepts the same order_no from another device', function () {
        syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['order_no' => 'T01-20260926-0001']));

        $this->app['auth']->forgetGuards();
        $otherToken = deviceToken($this->manager);

        expect(syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['order_no' => 'T01-20260926-0001']), $otherToken)['status'])
            ->toBe('accepted')
            ->and(Order::query()->count())->toBe(2);
    });
});

describe('duplicate', function () {
    it('returns the stored order again for a resubmitted sale, writing nothing twice', function () {
        $order = offlineOrder($this->cashier, [[$this->icedTea, 2]]);
        $first = syncOne($order);

        Carbon::setTestNow('2026-09-26 04:05:00');
        $second = syncOne($order);

        expect($second['status'])->toBe('duplicate')
            ->and($second['ulid'])->toBe($order['ulid'])
            ->and($second['message'])->toBeNull()
            ->and($second['order'])->toBe($first['order'])
            ->and(Order::query()->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(48)
            ->and(AuditLog::query()->where('action', 'order.completed')->count())->toBe(1);
    });

    it('reports the second copy of a ULID in the same batch as a duplicate', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 1]]);

        $response = syncOrders($this->token, [$order, $order])->assertOk();

        expect(array_column($response->json('data'), 'status'))->toBe(['accepted', 'duplicate'])
            ->and(Order::query()->count())->toBe(1);
    });

    it('returns a sale first committed online (a timeout) as a duplicate', function () {
        $online = simpleSale([[$this->hotDog, 1]]);
        $created = postOrder($this->cashier, $online)->assertCreated()->json('data');

        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['ulid' => $online['ulid']]));

        expect($result['status'])->toBe('duplicate')
            ->and($result['order']['invoice_no'])->toBe($created['invoice_no'])
            ->and($result['order']['source'])->toBe('online')
            ->and($result['order']['order_no'])->toBeNull()
            ->and(Order::query()->count())->toBe(1);
    });

    it('checks for a duplicate before validating the rest of the order', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 1]]);
        syncOne($order);

        expect(syncOne([...$order, 'order_no' => 'bad', 'items' => []])['status'])->toBe('duplicate');
    });
});

describe('rejected', function () {
    it('rejects an order that fails field validation, with the first message', function (Closure $mutate, string $message) {
        $order = $mutate(offlineOrder($this->cashier, [[$this->hotDog, 1]]));

        $result = syncOne($order);

        expect($result)->toBe([
            'ulid' => is_array($order) && is_string($order['ulid'] ?? null) ? $order['ulid'] : null,
            'status' => 'rejected',
            'order' => null,
            'message' => $message,
        ])
            ->and(Order::query()->count())->toBe(0);
    })->with([
        'no order_no' => [fn (array $o) => array_diff_key($o, ['order_no' => 0]), 'The order no field is required.'],
        'bad order_no' => [fn (array $o) => [...$o, 'order_no' => 't01-20260926-1'], 'The order no field format is invalid.'],
        'order_no too long a sequence' => [fn (array $o) => [...$o, 'order_no' => 'T01-20260926-1234567'], 'The order no field format is invalid.'],
        'no placed_at' => [fn (array $o) => array_diff_key($o, ['placed_at' => 0]), 'The placed at field is required.'],
        'placed_at not ISO 8601' => [fn (array $o) => [...$o, 'placed_at' => '26/09/2026 11:00'], 'The placed at field format is invalid.'],
        'placed_at without a zone' => [fn (array $o) => [...$o, 'placed_at' => '2026-09-26T11:00:00'], 'The placed at field format is invalid.'],
        'impossible placed_at' => [fn (array $o) => [...$o, 'placed_at' => '2026-02-30T11:00:00Z'], 'The placed at field must be a valid date.'],
        'no cashier_id' => [fn (array $o) => array_diff_key($o, ['cashier_id' => 0]), 'The cashier id field is required.'],
        'bad ulid' => [fn (array $o) => [...$o, 'ulid' => 'not-a-ulid'], 'The ulid field format is invalid.'],
        'no unit price' => [function (array $o) {
            unset($o['items'][0]['unit_price_cents']);

            return $o;
        }, 'The items.0.unit_price_cents field is required.'],
        'string unit price' => [function (array $o) {
            $o['items'][0]['unit_price_cents'] = '8000';

            return $o;
        }, 'The items.0.unit_price_cents field must be an integer.'],
        'no items' => [fn (array $o) => [...$o, 'items' => []], 'The items field is required.'],
        'senior citizen discount' => [fn (array $o) => [...$o, 'discount' => ['type' => 'senior_citizen', 'kind' => 'percent', 'value' => 2000]], 'The selected type is invalid.'],
        'two cash payments' => [fn (array $o) => [...$o, 'payments' => [
            ['method' => 'cash', 'amount_cents' => 4000, 'reference_no' => null],
            ['method' => 'cash', 'amount_cents' => 4000, 'reference_no' => null],
        ]], 'Only one cash payment is allowed.'],
        'gcash without reference' => [fn (array $o) => [...$o, 'payments' => [['method' => 'gcash', 'amount_cents' => 8000, 'reference_no' => null]]], 'The payments.0.reference_no field is required when payments.0.method is gcash.'],
        'bad table_no' => [fn (array $o) => [...$o, 'table_no' => 'A#1'], 'The table no field format is invalid.'],
        'not an object' => [fn (array $o) => 'oops', 'The ulid field is required.'],
    ]);

    it('rejects a product that never existed, but not a soft-deleted one', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 1]]);
        $order['items'][] = ['product_id' => 999999, 'qty' => 1, 'unit_price_cents' => 100, 'discount' => null, 'notes' => null];

        expect(syncOne($order)['message'])->toBe("Product 999999 doesn't exist.")
            ->and(Order::query()->count())->toBe(0);
    });

    it('rejects a cashier who is not an active user of the branch with sale.create', function (Closure $makeCashier) {
        $cashier = $makeCashier($this);

        $result = syncOne(offlineOrder($cashier ?? $this->cashier, [[$this->hotDog, 1]], $cashier === null ? ['cashier_id' => 999999] : []));
        $id = $cashier?->id ?? 999999;

        expect($result['status'])->toBe('rejected')
            ->and($result['message'])->toBe("User {$id} can't record sales in this branch.")
            ->and(Order::query()->count())->toBe(0);
    })->with([
        'inactive' => [fn ($test) => userWithRole('cashier', ['is_active' => false])],
        'soft-deleted' => [function ($test) {
            $user = userWithRole('cashier');
            $user->delete();

            return $user;
        }],
        'another branch' => [fn ($test) => User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('cashier')->create()],
        'without sale.create' => [fn ($test) => User::factory()->forBranch($test->branch)->create(['role_id' => customRole('auditor', ['report.view'])->id])],
        'unknown' => [fn ($test) => null],
    ]);

    it('rejects a customer that never existed', function () {
        expect(syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['customer_id' => 999999]))['message'])
            ->toBe("Customer 999999 doesn't exist.");
    });

    it('rejects an order_no already used on this device by another sale', function () {
        syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['order_no' => 'T01-20260926-0001']));

        $result = syncOne(offlineOrder($this->cashier, [[$this->icedTea, 1]], ['order_no' => 'T01-20260926-0001']));

        expect($result['status'])->toBe('rejected')
            ->and($result['message'])->toBe('The number T01-20260926-0001 was already used on this tablet for another sale.')
            ->and(Order::query()->count())->toBe(1)
            ->and(stockOf($this->icedTea))->toBe(50);
    });

    it('rejects a sale that cannot be priced (Q-008)', function () {
        $order = offlineOrder($this->cashier, [[$this->hotDog, 1]]);
        $order['items'][0]['discount'] = ['type' => 'promo', 'kind' => 'amount', 'value' => 9000];

        expect(syncOne($order)['message'])->toBe("The discount can't be more than ₱80.00.");
    });

    it('rejects a ULID already used by another branch (Q-008)', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northCashier = User::factory()->forBranch($north)->withRole('cashier')->create();
        $online = simpleSale([[$this->hotDog, 1]]);
        postOrder($northCashier, $online)->assertCreated();
        $this->app['auth']->forgetGuards();

        $result = syncOne(offlineOrder($this->cashier, [[$this->hotDog, 1]], ['ulid' => $online['ulid']]));

        expect($result)->toBe([
            'ulid' => $online['ulid'],
            'status' => 'rejected',
            'order' => null,
            'message' => 'This sale was already recorded in another branch.',
        ]);
    });

    it('writes nothing for a rejected order', function () {
        syncOne(offlineOrder($this->cashier, [[$this->icedTea, 1]], ['customer_id' => 999999]));

        expect(Order::query()->count())->toBe(0)
            ->and(stockOf($this->icedTea))->toBe(50)
            ->and(AuditLog::query()->where('action', 'order.completed')->count())->toBe(0)
            ->and(DB::table('sequences')->where('name', 'invoice')->count())->toBe(0);
    });
});

describe('batches', function () {
    it('returns one result per order in the same order, and a failure does not affect the others', function () {
        $a = offlineOrder($this->cashier, [[$this->hotDog, 1]]);
        $b = offlineOrder($this->cashier, [[$this->hotDog, 1]], ['cashier_id' => 999999]);
        $c = offlineOrder($this->cashier, [[$this->icedTea, 2]]);

        $response = syncOrders($this->token, [$a, $b, $c])->assertOk();

        expect(array_column($response->json('data'), 'ulid'))->toBe([$a['ulid'], $b['ulid'], $c['ulid']])
            ->and(array_column($response->json('data'), 'status'))->toBe(['accepted', 'rejected', 'accepted'])
            ->and($response->json('data.0.order.invoice_no'))->toBe('INV-MAIN-00000001')
            ->and($response->json('data.2.order.invoice_no'))->toBe('INV-MAIN-00000002')
            ->and(Order::query()->count())->toBe(2)
            ->and(stockOf($this->icedTea))->toBe(48);
    });

    it('rolls back only the order that hits an unexpected server error, and rejects it for a retry (Q-008)', function () {
        // The audit write fails for the first order only, inside its transaction.
        $this->app->instance(RecordAuditLog::class, new class extends RecordAuditLog
        {
            private int $calls = 0;

            public function execute(string $action, ?User $actor = null, ?Model $subject = null, ?array $changes = null, ?string $ip = null): AuditLog
            {
                if ($this->calls++ === 0) {
                    throw new RuntimeException('Simulated failure.');
                }

                return parent::execute($action, $actor, $subject, $changes, $ip);
            }
        });

        $a = offlineOrder($this->cashier, [[$this->icedTea, 5]]);
        $b = offlineOrder($this->cashier, [[$this->icedTea, 1]]);

        $response = syncOrders($this->token, [$a, $b])->assertOk();

        expect($response->json('data.0'))->toBe([
            'ulid' => $a['ulid'], 'status' => 'rejected', 'order' => null, 'message' => "The server couldn't record this sale. Try again.",
        ])
            ->and($response->json('data.1.status'))->toBe('accepted')
            ->and(Order::query()->pluck('ulid')->all())->toBe([$b['ulid']])
            ->and(stockOf($this->icedTea))->toBe(49);

        // The retry goes through.
        expect(syncOne($a)['status'])->toBe('accepted');
    });

    it('accepts 50 orders', function () {
        $orders = array_map(fn () => offlineOrder($this->cashier, [[$this->hotDog, 1]]), range(1, 50));

        $response = syncOrders($this->token, $orders)->assertOk();

        expect(array_unique(array_column($response->json('data'), 'status')))->toBe(['accepted'])
            ->and(Order::query()->count())->toBe(50);
    });
});

/**
 * Sync a batch with the given number of orders from the same cashier and customer, and
 * count the lookup queries by kind (captured with DB::listen).
 *
 * @return array<string, int>
 */
function lookupQueries(int $orders): array
{
    $customer = Customer::factory()->create();
    $batch = array_map(fn () => offlineOrder(test()->cashier, [[test()->hotDog, 1], [test()->icedTea, 2]], [
        'customer_id' => $customer->id,
    ]), range(1, $orders));

    $sql = [];
    DB::listen(function ($query) use (&$sql) {
        $sql[] = $query->sql;
    });

    $response = syncOrders(test()->token, $batch)->assertOk();
    expect(array_unique(array_column($response->json('data'), 'status')))->toBe(['accepted']);

    $count = fn (string $pattern) => count(array_filter($sql, fn (string $s) => preg_match($pattern, $s) === 1));

    return [
        'cashier' => $count('/from `users` where .*`is_active`/'),
        'roles' => $count('/from `roles`/'),
        'permissions' => $count('/from `permissions`/'),
        'products' => $count('/from `products`/'),
        'categories' => $count('/from `categories`/'),
        'customer' => $count('/exists\(select \* from `customers`/'),
    ];
}

describe('query count', function () {
    it('looks up the cashier, customer and products once per batch, not once per order', function () {
        $one = lookupQueries(1);
        $twenty = lookupQueries(20);

        expect($twenty)->toBe($one)
            ->and($twenty)->toBe([
                'cashier' => 1,
                'roles' => 2, // the caller's session and the cashier
                'permissions' => 2,
                'products' => 1,
                'categories' => 1,
                'customer' => 1,
            ])
            ->and(Order::query()->count())->toBe(21);
    });
});

describe('whole-request errors', function () {
    it('returns 409 when the token is not bound to a device', function () {
        syncOrders(tokenFor($this->cashier), [offlineOrder($this->cashier, [[$this->hotDog, 1]])])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);

        expect(Order::query()->count())->toBe(0);
    });

    it('returns 409 when the bound device was deleted or belongs to another branch', function (Closure $change) {
        $change($this->device);

        syncOrders($this->token, [offlineOrder($this->cashier, [[$this->hotDog, 1]])])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);
    })->with([
        'deleted' => [fn (Device $device) => $device->delete()],
        'another branch' => [fn (Device $device) => $device->forceFill(['branch_id' => Branch::factory()->create()->id])->save()],
    ]);

    it('returns 409 before validating the envelope', function () {
        test()->withToken(tokenFor($this->cashier))->postJson('/api/v1/sync/orders', [])->assertStatus(409);
    });

    it('returns 403 without sale.create, before the device check', function () {
        $auditor = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('auditor', ['report.view'])->id]);

        syncOrders(tokenFor($auditor), [offlineOrder($this->cashier, [[$this->hotDog, 1]])])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 422 on orders for a bad envelope', function (mixed $orders) {
        $body = $orders === 'missing' ? [] : ['orders' => $orders];

        $this->withToken($this->token)->postJson('/api/v1/sync/orders', $body)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['orders']);
    })->with([
        'missing' => ['missing'],
        'empty' => [[]],
        'not an array' => ['x'],
    ]);

    it('returns 422 for 51 orders', function () {
        $orders = array_map(fn () => offlineOrder($this->cashier, [[$this->hotDog, 1]]), range(1, 51));

        syncOrders($this->token, $orders)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['orders']);

        expect(Order::query()->count())->toBe(0);
    });

    it('returns 401 without a token', function () {
        $this->flushHeaders()->postJson('/api/v1/sync/orders', ['orders' => []])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

describe('online sales (POST /orders)', function () {
    it('records the token\'s device and source online, the rest unchanged', function () {
        $payload = simpleSale([[$this->hotDog, 1]]);

        $data = $this->withToken($this->token)
            ->postJson('/api/v1/orders', $payload, ['Idempotency-Key' => $payload['ulid']])
            ->assertCreated()
            ->json('data');

        $stored = Order::query()->sole();

        expect($stored->device_id)->toBe($this->device->id)
            ->and($stored->source)->toBe('online')
            ->and($stored->order_no)->toBeNull()
            ->and($stored->synced_at)->toBeNull()
            ->and($data)->toMatchArray(['order_no' => null, 'placed_at' => '2026-09-26T04:00:00Z', ...onlineOrderFields()]);
    });

    it('records a null device for a token that was never registered', function () {
        $this->app['auth']->forgetGuards();
        sell($this->cashier, [[$this->hotDog, 1]]);

        expect(Order::query()->sole()->device_id)->toBeNull()
            ->and(PersonalAccessToken::query()->whereNull('device_id')->count())->toBeGreaterThan(0);
    });
});
