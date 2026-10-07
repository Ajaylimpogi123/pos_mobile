<?php

use App\Actions\Sales\ApproveDiscount;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\IdempotencyKey;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:12:09 in Manila: business day 2026-09-25.
    Carbon::setTestNow('2026-09-25 04:12:09');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->manager = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $meals = Category::factory()->create(['name' => 'Meals']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);

    $this->hotDog = Product::factory()->forCategory($breakfast)->create([
        'name' => 'Hot Dog', 'sku' => 'BRK-002', 'price_cents' => 8000, 'cost_cents' => 3600,
    ]);
    $this->riceCake = Product::factory()->forCategory($meals)->create([
        'name' => 'Rice Cake', 'sku' => null, 'price_cents' => 4500, 'cost_cents' => 2000, 'is_vatable' => false,
    ]);
    $this->icedTea = Product::factory()->forCategory($drinks)->create([
        'name' => 'Iced Tea', 'sku' => 'DRK-001', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true,
    ]);
    stockUp($this->icedTea, 50);

    $this->customer = Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * The contract's worked example B.
 */
function exampleB(array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'shift_ulid' => testShiftUlid(),
        'customer_id' => test()->customer->id,
        'notes' => null,
        'items' => [
            ['product_id' => test()->hotDog->id, 'qty' => 1, 'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000], 'notes' => 'No ketchup'],
            ['product_id' => test()->riceCake->id, 'qty' => 2, 'discount' => null, 'notes' => null],
            ['product_id' => test()->icedTea->id, 'qty' => 3, 'discount' => null, 'notes' => null],
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
 * Example B with a ₱50.00 order discount: 800 + 5000 = 5800 of 27500 (21%), above the cashier's 10%.
 */
function bigDiscount(array $overrides = []): array
{
    return exampleB([
        'discount' => ['type' => 'manual', 'kind' => 'amount', 'value' => 5000],
        'client_total_cents' => 21700,
        'payments' => [['method' => 'cash', 'amount_cents' => 21700, 'reference_no' => null]],
        ...$overrides,
    ]);
}

/**
 * Nothing about a sale was written: no order, line, payment, sale movement or number.
 */
function expectNoSaleWritten(): void
{
    expect(Order::query()->count())->toBe(0)
        ->and(OrderItem::query()->count())->toBe(0)
        ->and(Payment::query()->count())->toBe(0)
        ->and(StockMovement::query()->where('type', 'sale')->count())->toBe(0)
        ->and(DB::table('sequences')->count())->toBe(0)
        ->and(AuditLog::query()->where('action', 'order.completed')->count())->toBe(0);
}

describe('success', function () {
    it('completes worked example B and returns 201 with the exact Order', function () {
        $payload = exampleB();

        $response = postOrder($this->cashier, $payload)->assertCreated();

        $order = Order::query()->sole();
        $items = OrderItem::query()->orderBy('id')->pluck('id')->all();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(orderKeys())
            ->and(array_keys($response->json('data.items.0')))->toBe(orderItemKeys());

        $response->assertExactJson(['data' => [
            'ulid' => $payload['ulid'],
            'invoice_no' => 'INV-MAIN-00000001',
            'order_no' => null,
            'queue_no' => 1,
            'table_no' => null,
            'business_date' => '2026-09-25',
            'status' => 'completed',
            'placed_at' => '2026-09-25T04:12:09Z',
            'cashier' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
            'authorized_by' => null,
            'customer' => ['id' => $this->customer->id, 'full_name' => 'Maria Santos'],
            'notes' => null,
            'subtotal_cents' => 27500,
            'line_discounts_cents' => 800,
            'order_discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 1000, 'amount_cents' => 1000],
            'sc_pwd' => null,
            'discount_cents' => 1800,
            'total_cents' => 25700,
            'vatable_sales_cents' => 15212,
            'vat_amount_cents' => 1825,
            'vat_exempt_sales_cents' => 8663,
            'tendered_cents' => 30000,
            'change_cents' => 4300,
            'client_total_cents' => 25700,
            'has_total_mismatch' => false,
            ...onlineOrderFields(),
            'shift_ulid' => $payload['shift_ulid'],
            ...unreversedOrderFields(),
            'items' => [
                ['id' => $items[0], 'product_id' => $this->hotDog->id, 'product_name' => 'Hot Dog', 'category_id' => $this->hotDog->category_id, 'category_name' => 'Breakfast', 'sku' => 'BRK-002', 'qty' => 1, 'unit_price_cents' => 8000, 'gross_cents' => 8000, 'is_vatable' => true, 'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000], 'line_discount_cents' => 800, 'order_discount_share_cents' => 270, 'line_total_cents' => 6930, 'notes' => 'No ketchup', 'refunded_qty' => 0, 'refunded_cents' => 0, ...noScPwdLine()],
                ['id' => $items[1], 'product_id' => $this->riceCake->id, 'product_name' => 'Rice Cake', 'category_id' => $this->riceCake->category_id, 'category_name' => 'Meals', 'sku' => null, 'qty' => 2, 'unit_price_cents' => 4500, 'gross_cents' => 9000, 'is_vatable' => false, 'discount' => null, 'line_discount_cents' => 0, 'order_discount_share_cents' => 337, 'line_total_cents' => 8663, 'notes' => null, 'refunded_qty' => 0, 'refunded_cents' => 0, ...noScPwdLine()],
                ['id' => $items[2], 'product_id' => $this->icedTea->id, 'product_name' => 'Iced Tea', 'category_id' => $this->icedTea->category_id, 'category_name' => 'Drinks', 'sku' => 'DRK-001', 'qty' => 3, 'unit_price_cents' => 3500, 'gross_cents' => 10500, 'is_vatable' => true, 'discount' => null, 'line_discount_cents' => 0, 'order_discount_share_cents' => 393, 'line_total_cents' => 10107, 'notes' => null, 'refunded_qty' => 0, 'refunded_cents' => 0, ...noScPwdLine()],
            ],
            'payments' => [
                ['method' => 'gcash', 'amount_cents' => 10000, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => '1012345678901'],
                ['method' => 'cash', 'amount_cents' => 15700, 'tendered_cents' => 20000, 'change_cents' => 4300, 'reference_no' => null],
            ],
            'refunds' => [],
        ]]);

        // Stored as returned, plus what is never returned.
        expect($order->branch_id)->toBe($this->branch->id)
            ->and($order->user_id)->toBe($this->cashier->id)
            ->and($order->source)->toBe('online')
            ->and($order->device_id)->toBeNull() // the token was never registered to a device
            ->and($order->discount_type)->toBe('promo')
            ->and($order->order_discount_cents)->toBe(1000)
            ->and(OrderItem::query()->orderBy('id')->pluck('unit_cost_cents')->all())->toBe([3600, 2000, 1575])
            ->and(str_contains($response->getContent(), 'unit_cost_cents'))->toBeFalse()
            ->and((int) Payment::query()->sum('amount_cents'))->toBe(25700);
    });

    it('completes worked example A (no discount, no customer)', function () {
        $egg = Product::factory()->forCategory(Category::factory()->create(['name' => 'Rice Meals']))
            ->create(['name' => 'Egg with Rice', 'price_cents' => 5000]);

        $response = postOrder($this->cashier, simpleSale([[$egg, 2], [$this->icedTea, 1]]))->assertCreated();

        $response->assertJsonPath('data.subtotal_cents', 13500)
            ->assertJsonPath('data.line_discounts_cents', 0)
            ->assertJsonPath('data.order_discount', null)
            ->assertJsonPath('data.discount_cents', 0)
            ->assertJsonPath('data.total_cents', 13500)
            ->assertJsonPath('data.vatable_sales_cents', 12054)
            ->assertJsonPath('data.vat_amount_cents', 1446)
            ->assertJsonPath('data.vat_exempt_sales_cents', 0)
            ->assertJsonPath('data.customer', null)
            ->assertJsonPath('data.authorized_by', null)
            ->assertJsonPath('data.tendered_cents', 13500)
            ->assertJsonPath('data.change_cents', 0)
            ->assertJsonPath('data.items.0.discount', null)
            ->assertJsonPath('data.payments', [
                ['method' => 'cash', 'amount_cents' => 13500, 'tendered_cents' => 13500, 'change_cents' => 0, 'reference_no' => null],
            ]);

        expect(Order::query()->sole()->discount_type)->toBe('none');
    });

    it('depletes stock with one sale movement per tracked product and writes the audit entry', function () {
        $water = Product::factory()->forCategory($this->icedTea->category)->create(['name' => 'Bottled Water', 'price_cents' => 2000, 'cost_cents' => 900, 'track_stock' => true]);
        stockUp($water, 10);

        $payload = simpleSale([[$this->icedTea, 2], [$this->hotDog, 1], [$water, 4], [$this->icedTea, 5]]);
        postOrder($this->cashier, $payload)->assertCreated();

        $order = Order::query()->sole();
        $movements = StockMovement::query()->where('type', 'sale')->orderBy('product_id')->get();

        expect($movements)->toHaveCount(2)
            ->and($movements->map(fn (StockMovement $m) => [$m->product_id, $m->wholeQtyDelta(), $m->unit_cost_cents, $m->reference_type, $m->reference_id, $m->branch_id, $m->created_by])->all())
            ->toBe([
                [$this->icedTea->id, -7, 1575, $order->getMorphClass(), $order->id, $this->branch->id, $this->cashier->id],
                [$water->id, -4, 900, $order->getMorphClass(), $order->id, $this->branch->id, $this->cashier->id],
            ])
            ->and($movements->every(fn (StockMovement $m) => $m->occurred_at->equalTo($order->placed_at)))->toBeTrue()
            ->and(stockOf($this->icedTea))->toBe(43)
            ->and(stockOf($water))->toBe(6);

        // The ledger still sums to the cached level.
        expect((int) StockMovement::query()->where('product_id', $this->icedTea->id)->sum('qty_delta'))->toBe(43);

        $audit = AuditLog::query()->where('action', 'order.completed')->sole();
        expect($audit->actor_id)->toBe($this->cashier->id)
            ->and($audit->subject_type)->toBe($order->getMorphClass())
            ->and($audit->subject_id)->toBe($order->id)
            ->and(ksortDeep($audit->changes))->toBe(['authorized_by' => null, 'invoice_no' => 'INV-MAIN-00000001', 'sc_pwd' => null, 'total_cents' => 40500]);
    });

    it('keeps notes, snapshots the product at sale time and reads the current customer', function () {
        $payload = exampleB(['notes' => 'Table 4']);
        postOrder($this->cashier, $payload)->assertCreated();

        $this->hotDog->update(['name' => 'Jumbo Hot Dog', 'price_cents' => 9900, 'sku' => 'BRK-099']);
        $this->customer->update(['last_name' => 'Santos-Reyes']);
        $this->customer->delete();

        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/orders/'.$payload['ulid'])->assertOk()
            ->assertJsonPath('data.notes', 'Table 4')
            ->assertJsonPath('data.items.0.product_name', 'Hot Dog')
            ->assertJsonPath('data.items.0.sku', 'BRK-002')
            ->assertJsonPath('data.items.0.unit_price_cents', 8000)
            ->assertJsonPath('data.customer', ['id' => $this->customer->id, 'full_name' => 'Maria Santos-Reyes']);
    });

    it('accepts the same product on several lines', function () {
        $payload = simpleSale([[$this->hotDog, 1], [$this->hotDog, 2]]);
        $payload['items'][1]['notes'] = 'Extra mustard';

        postOrder($this->cashier, $payload)->assertCreated()
            ->assertJsonPath('data.subtotal_cents', 24000)
            ->assertJsonPath('data.items.1.notes', 'Extra mustard');
    });
});

describe('auth (401 / 403)', function () {
    it('returns 401 without a token', function () {
        $this->postJson('/api/v1/orders', exampleB())
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 403 without sale.create, before validation and before anything is written', function () {
        $reporter = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('reporter', ['report.view'])->id]);

        postOrder($reporter, exampleB())->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        postOrder($reporter, ['ulid' => 'nope'], 'nope')->assertForbidden();

        expectNoSaleWritten();
        expect(IdempotencyKey::query()->count())->toBe(0);
    });
});

describe('field validation (422)', function () {
    it('requires the fields the contract requires', function () {
        $ulid = newUlid();

        $errors = postOrder($this->cashier, ['ulid' => $ulid])->assertUnprocessable()->json('errors');

        expect($errors)->toMatchArray([
            'items' => ['The items field is required.'],
            'payments' => ['The payments field is required.'],
            'client_total_cents' => ['The client total cents field is required.'],
            'shift_ulid' => ['The shift ulid field is required.'],
        ])->and(array_keys($errors))->toEqualCanonicalizing(['items', 'payments', 'client_total_cents', 'shift_ulid']);

        postOrder($this->cashier, exampleB(['ulid' => null]), $ulid)->assertUnprocessable()
            ->assertJsonValidationErrors(['ulid' => 'The ulid field is required.']);
    });

    it('validates the ulid format', function (string $ulid) {
        postOrder($this->cashier, exampleB(['ulid' => $ulid]))->assertUnprocessable()
            ->assertJsonValidationErrors(['ulid' => 'The ulid field format is invalid.']);
    })->with([
        'lowercase' => strtolower(newUlid()),
        'too short' => substr(newUlid(), 0, 25),
        'bad first character' => '8'.substr(newUlid(), 1),
        'forbidden letter' => substr(newUlid(), 0, 25).'U',
    ]);

    it('validates items and their lines', function (array $items, string $field, string $message) {
        postOrder($this->cashier, exampleB(['items' => $items]))->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);
    })->with([
        'empty' => [[], 'items', 'The items field is required.'],
        'not a list' => [['a' => ['product_id' => 1, 'qty' => 1]], 'items', 'The items field must be a list.'],
        'missing product' => [[['qty' => 1]], 'items.0.product_id', 'The items.0.product_id field is required.'],
        'qty zero' => [[['product_id' => 1, 'qty' => 0]], 'items.0.qty', 'The items.0.qty field must be at least 1.'],
        'qty too big' => [[['product_id' => 1, 'qty' => 1000]], 'items.0.qty', 'The items.0.qty field must not be greater than 999.'],
        'qty fraction' => [[['product_id' => 1, 'qty' => 1.5]], 'items.0.qty', 'The items.0.qty field must be an integer.'],
        'notes too long' => [[['product_id' => 1, 'qty' => 1, 'notes' => str_repeat('n', 121)]], 'items.0.notes', 'The items.0.notes field must not be greater than 120 characters.'],
    ]);

    it('allows at most 100 lines', function () {
        $items = array_fill(0, 101, ['product_id' => $this->hotDog->id, 'qty' => 1]);

        postOrder($this->cashier, exampleB(['items' => $items]))->assertUnprocessable()
            ->assertJsonValidationErrors(['items' => 'The items field must not have more than 100 items.']);
    });

    it('validates discount objects, rejecting SC/PWD types for now', function (array $discount, string $field, string $message) {
        postOrder($this->cashier, exampleB(['discount' => $discount]))->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        $items = exampleB()['items'];
        $items[1]['discount'] = $discount;

        postOrder($this->cashier, exampleB(['items' => $items]))->assertUnprocessable()
            ->assertJsonValidationErrors(['items.1.'.$field => str_replace('The discount field', 'The items.1.discount field', $message)]);
    })->with([
        'senior citizen' => [['type' => 'senior_citizen', 'kind' => 'percent', 'value' => 2000], 'discount.type', 'The selected type is invalid.'],
        'pwd' => [['type' => 'pwd', 'kind' => 'percent', 'value' => 2000], 'discount.type', 'The selected type is invalid.'],
        'unknown kind' => [['type' => 'promo', 'kind' => 'fixed', 'value' => 100], 'discount.kind', 'The selected kind is invalid.'],
        'percent above 100%' => [['type' => 'promo', 'kind' => 'percent', 'value' => 10001], 'discount.value', 'The value field must be between 1 and 10000.'],
        'percent zero' => [['type' => 'promo', 'kind' => 'percent', 'value' => 0], 'discount.value', 'The value field must be between 1 and 10000.'],
        'amount too big' => [['type' => 'manual', 'kind' => 'amount', 'value' => 1000000001], 'discount.value', 'The value field must be between 1 and 1000000000.'],
        'value as string' => [['type' => 'manual', 'kind' => 'amount', 'value' => '500'], 'discount.value', 'The value field must be an integer.'],
        'missing keys' => [['type' => 'promo'], 'discount', 'The discount field must contain entries for: type, kind, value.'],
    ]);

    it('validates payments', function (array $payments, string $field, string $message) {
        postOrder($this->cashier, exampleB(['payments' => $payments]))->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);
    })->with([
        'unknown method' => [[['method' => 'card', 'amount_cents' => 25700]], 'payments.0.method', 'The selected payments.0.method is invalid.'],
        'amount zero' => [[['method' => 'cash', 'amount_cents' => 0]], 'payments.0.amount_cents', 'The payments.0.amount_cents field must be at least 1.'],
        'amount as string' => [[['method' => 'cash', 'amount_cents' => '25700']], 'payments.0.amount_cents', 'The payments.0.amount_cents field must be an integer.'],
        'amount as decimal' => [[['method' => 'cash', 'amount_cents' => 25700.5]], 'payments.0.amount_cents', 'The payments.0.amount_cents field must be an integer.'],
        'amount too big' => [[['method' => 'cash', 'amount_cents' => 1000000001]], 'payments.0.amount_cents', 'The payments.0.amount_cents field must not be greater than 1000000000.'],
        'gcash without reference' => [[['method' => 'gcash', 'amount_cents' => 25700, 'reference_no' => null]], 'payments.0.reference_no', 'The payments.0.reference_no field is required when payments.0.method is gcash.'],
        'gcash bad reference' => [[['method' => 'gcash', 'amount_cents' => 25700, 'reference_no' => 'ab c/1']], 'payments.0.reference_no', 'The payments.0.reference_no field format is invalid.'],
        'gcash long reference' => [[['method' => 'gcash', 'amount_cents' => 25700, 'reference_no' => str_repeat('9', 65)]], 'payments.0.reference_no', 'The payments.0.reference_no field must not be greater than 64 characters.'],
        'cash with reference' => [[['method' => 'cash', 'amount_cents' => 25700, 'reference_no' => 'X1']], 'payments.0.reference_no', 'The payments.0.reference_no field is prohibited when payments.0.method is cash.'],
        'two cash payments' => [[['method' => 'cash', 'amount_cents' => 700], ['method' => 'cash', 'amount_cents' => 25000]], 'payments.1.method', 'Only one cash payment is allowed.'],
        'six payments' => [array_fill(0, 6, ['method' => 'gcash', 'amount_cents' => 100, 'reference_no' => 'R1']), 'payments', 'The payments field must not have more than 5 items.'],
    ]);

    it('rejects null payments', function () {
        postOrder($this->cashier, exampleB(['payments' => null]))->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => 'The payments field must be an array.']);
    });

    it('validates the checksum, customer, notes and discount authorization fields', function (string $key, mixed $value, string $field) {
        postOrder($this->cashier, exampleB([$key => $value]))->assertUnprocessable()
            ->assertJsonValidationErrorFor($field);
    })->with([
        'negative total' => ['client_total_cents', -1, 'client_total_cents'],
        'total as string' => ['client_total_cents', '25700', 'client_total_cents'],
        'unknown customer' => ['customer_id', 999999, 'customer_id'],
        'notes too long' => ['notes', str_repeat('n', 256), 'notes'],
        'authorization without pin' => ['discount_authorization', ['user_id' => 1], 'discount_authorization'],
        'pin too short' => ['discount_authorization', ['user_id' => 1, 'pin' => '123'], 'discount_authorization.pin'],
        'pin as number' => ['discount_authorization', ['user_id' => 1, 'pin' => 2468], 'discount_authorization.pin'],
        'pin not digits' => ['discount_authorization', ['user_id' => 1, 'pin' => '12a4'], 'discount_authorization.pin'],
    ]);

    it('rejects a soft-deleted customer', function () {
        $this->customer->delete();

        postOrder($this->cashier, exampleB())->assertUnprocessable()
            ->assertJsonValidationErrors(['customer_id' => 'The selected customer id is invalid.']);
    });

    it('writes nothing when validation fails', function () {
        postOrder($this->cashier, exampleB(['client_total_cents' => -5]))->assertUnprocessable();

        expectNoSaleWritten();
        expect(stockOf($this->icedTea))->toBe(50);
    });
});

describe('check 2: menu', function () {
    it('rejects products that are no longer on the menu, on each line', function () {
        $deleted = Product::factory()->create(['name' => 'Old Pie']);
        $deleted->delete();
        $inactiveCategory = Product::factory()->forCategory(Category::factory()->inactive()->create())->create();
        $deletedCategory = Product::factory()->create();
        Category::query()->whereKey($deletedCategory->category_id)->update(['deleted_at' => now()]);

        $payload = simpleSale([[$this->hotDog, 1], [$deleted, 1], [$inactiveCategory, 1], [$deletedCategory, 1]]);
        $payload['items'][] = ['product_id' => 999999, 'qty' => 1];

        $errors = postOrder($this->cashier, $payload)->assertUnprocessable()->json('errors');

        expect($errors)->toBe([
            'items.1.product_id' => ['This product is no longer on the menu.'],
            'items.2.product_id' => ['This product is no longer on the menu.'],
            'items.3.product_id' => ['This product is no longer on the menu.'],
            'items.4.product_id' => ['This product is no longer on the menu.'],
        ]);
    });

    it('rejects an unavailable product with its name', function () {
        $this->riceCake->update(['is_available' => false]);

        postOrder($this->cashier, exampleB())->assertUnprocessable()
            ->assertJsonValidationErrors(['items.1.product_id' => '"Rice Cake" is unavailable.']);

        expectNoSaleWritten();
    });
});

describe('check 3: pricing', function () {
    it('rejects a line discount above its line, with the base in pesos', function () {
        $payload = exampleB();
        $payload['items'][0]['discount'] = ['type' => 'manual', 'kind' => 'amount', 'value' => 8001];

        postOrder($this->cashier, $payload)->assertUnprocessable()
            ->assertExactJson([
                'message' => "The discount can't be more than ₱80.00.",
                'errors' => ['items.0.discount.value' => ["The discount can't be more than ₱80.00."]],
            ]);
    });

    it('rejects an order discount above the base after line discounts', function () {
        // B = 7200 + 9000 + 10500 = 26700
        postOrder($this->cashier, exampleB(['discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 26701]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['discount.value' => "The discount can't be more than ₱267.00."]);
    });

    it('rejects a sale above ₱10,000,000', function () {
        $expensive = Product::factory()->create(['price_cents' => 100000000]);

        postOrder($this->cashier, simpleSale([[$expensive, 10], [$this->hotDog, 1]], [
            'payments' => [['method' => 'cash', 'amount_cents' => 1000000000, 'reference_no' => null]],
        ]))->assertUnprocessable()
            ->assertJsonValidationErrors(['items' => 'This sale is too large.']);
    });

    it('prices with the server\'s current price, not the app\'s', function () {
        $this->hotDog->update(['price_cents' => 8500]);

        // The app still thinks 8000: the new total is 500 more (less 10% line discount: 450 more).
        postOrder($this->cashier, exampleB())->assertUnprocessable()
            ->assertJsonValidationErrors(['client_total_cents']);
    });
});

describe('check 4: checksum', function () {
    it('accepts an exact total without a mismatch', function () {
        postOrder($this->cashier, exampleB())->assertCreated()->assertJsonPath('data.has_total_mismatch', false);
    });

    it('accepts a difference of exactly 1 centavo and flags it', function (int $clientTotal) {
        postOrder($this->cashier, exampleB(['client_total_cents' => $clientTotal]))->assertCreated()
            ->assertJsonPath('data.total_cents', 25700)
            ->assertJsonPath('data.client_total_cents', $clientTotal)
            ->assertJsonPath('data.has_total_mismatch', true);

        expect(Order::query()->sole()->has_total_mismatch)->toBeTrue();
    })->with([25699, 25701]);

    it('rejects a larger difference', function (int $clientTotal) {
        postOrder($this->cashier, exampleB(['client_total_cents' => $clientTotal]))->assertUnprocessable()
            ->assertExactJson([
                'message' => 'The menu has changed since your last sync. Review the new total.',
                'errors' => ['client_total_cents' => ['The menu has changed since your last sync. Review the new total.']],
            ]);

        expectNoSaleWritten();
    })->with([25698, 25702, 0]);
});

describe('check 5: payments', function () {
    it('rejects GCash above the total', function () {
        postOrder($this->cashier, exampleB(['payments' => [
            ['method' => 'gcash', 'amount_cents' => 25701, 'reference_no' => 'REF-1'],
        ]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => "GCash can't be more than the total."]);
    });

    it('rejects a short payment with the amount due', function () {
        postOrder($this->cashier, exampleB(['payments' => [
            ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => 'REF-1'],
            ['method' => 'cash', 'amount_cents' => 10000, 'reference_no' => null],
        ]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => 'The payment is short by ₱57.00.']);
    });

    it('reports an empty payment list on a non-zero sale as short', function () {
        postOrder($this->cashier, exampleB(['payments' => []]))->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => 'The payment is short by ₱257.00.']);
    });

    it('checks GCash before the shortfall', function () {
        postOrder($this->cashier, exampleB(['payments' => [
            ['method' => 'gcash', 'amount_cents' => 30000, 'reference_no' => 'REF-1'],
        ], 'client_total_cents' => 25700]))->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => "GCash can't be more than the total."]);
    });

    it('accepts a ₱0 sale with no payments', function () {
        $freebie = Product::factory()->create(['name' => 'Free Water', 'price_cents' => 0]);

        postOrder($this->cashier, simpleSale([[$freebie, 2]]))->assertCreated()
            ->assertJsonPath('data.total_cents', 0)
            ->assertJsonPath('data.tendered_cents', 0)
            ->assertJsonPath('data.payments', []);
    });

    it('accepts GCash only and split tender with change from the cash payment', function () {
        postOrder($this->cashier, exampleB(['payments' => [
            ['method' => 'gcash', 'amount_cents' => 25700, 'reference_no' => 'ABC-123'],
        ]]))->assertCreated()
            ->assertJsonPath('data.tendered_cents', 25700)
            ->assertJsonPath('data.change_cents', 0);

        // The cash comes first here; the change still comes out of it.
        postOrder($this->cashier, exampleB(['payments' => [
            ['method' => 'cash', 'amount_cents' => 50000, 'reference_no' => null],
            ['method' => 'gcash', 'amount_cents' => 5700, 'reference_no' => 'ABC-124'],
        ]]))->assertCreated()
            ->assertJsonPath('data.tendered_cents', 55700)
            ->assertJsonPath('data.change_cents', 30000)
            ->assertJsonPath('data.payments', [
                ['method' => 'cash', 'amount_cents' => 20000, 'tendered_cents' => 50000, 'change_cents' => 30000, 'reference_no' => null],
                ['method' => 'gcash', 'amount_cents' => 5700, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'ABC-124'],
            ]);

        foreach (Order::query()->with('payments')->get() as $order) {
            expect($order->payments->sum('amount_cents'))->toBe($order->total_cents);
        }
    });
});

describe('check 6: discount approval', function () {
    it('needs no approval within the cashier\'s limit and ignores discount_authorization', function () {
        // 1800 of 27500 = 6.5%, within 10%. A wrong PIN is not even checked.
        postOrder($this->cashier, exampleB(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '0000']]))
            ->assertCreated()
            ->assertJsonPath('data.authorized_by', null);

        expect(Order::query()->sole()->authorized_by)->toBeNull();

        // Exactly at the limit (2750 of 27500 = 10%) still needs no approval.
        expect(ApproveDiscount::isNeeded($this->cashier, 27500, 2750))->toBeFalse()
            ->and(ApproveDiscount::isNeeded($this->cashier, 27500, 2751))->toBeTrue()
            ->and(ApproveDiscount::isNeeded($this->cashier, 27500, 0))->toBeFalse();
    });

    it('requires approval above the limit', function () {
        postOrder($this->cashier, bigDiscount())->assertUnprocessable()
            ->assertExactJson([
                'message' => 'A manager must approve this discount.',
                'errors' => ['discount_authorization' => ['A manager must approve this discount.']],
            ]);

        expectNoSaleWritten();
    });

    it('requires approval for any discount when the cashier lacks discount.apply', function () {
        $noDiscounts = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('seller', ['sale.create'], 100)->id]);

        postOrder($noDiscounts, exampleB())->assertUnprocessable()
            ->assertJsonValidationErrors(['discount_authorization' => 'A manager must approve this discount.']);

        postOrder($noDiscounts, simpleSale([[$this->hotDog, 1]]))->assertCreated();
    });

    it('records the approver as authorized_by', function () {
        $payload = bigDiscount(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '2468']]);

        postOrder($this->cashier, $payload)->assertCreated()
            ->assertJsonPath('data.discount_cents', 5800)
            ->assertJsonPath('data.cashier.id', $this->cashier->id)
            ->assertJsonPath('data.authorized_by', ['id' => $this->manager->id, 'name' => 'Marco Manager']);

        expect(Order::query()->sole()->authorized_by)->toBe($this->manager->id)
            ->and(AuditLog::query()->where('action', 'order.completed')->sole()->changes['authorized_by'])->toBe($this->manager->id);
    });

    it('rejects an approver who does not qualify', function (Closure $approver) {
        $user = $approver();

        postOrder($this->cashier, bigDiscount(['discount_authorization' => ['user_id' => $user?->id ?? 999999, 'pin' => '2468']]))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => "This person can't approve this discount.",
                'errors' => ['discount_authorization.user_id' => ["This person can't approve this discount."]],
            ]);
    })->with([
        'unknown' => fn () => null,
        'a cashier (no discount.override)' => fn () => withPin(userWithRole('cashier'), '2468'),
        'inactive' => fn () => withPin(userWithRole('manager', ['is_active' => false]), '2468'),
        'soft-deleted' => fn () => tap(withPin(userWithRole('manager'), '2468'))->delete(),
        'without a PIN' => fn () => userWithRole('manager'),
        'in another branch' => fn () => withPin(User::factory()->forBranch(Branch::factory()->create())->withRole('manager')->create(), '2468'),
        'limit too low' => fn () => withPin(User::factory()->forBranch(test()->branch)->create([
            'role_id' => customRole('supervisor', ['sale.create', 'discount.apply', 'discount.override'], 20)->id,
        ]), '2468'),
    ]);

    it('accepts an approver whose limit exactly covers the discount', function () {
        // 5800 × 100 = 580000 ≤ 27500 × 22 = 605000
        $supervisor = withPin(User::factory()->forBranch($this->branch)->create([
            'role_id' => customRole('supervisor', ['discount.override'], 22)->id,
        ]), '1470');

        postOrder($this->cashier, bigDiscount(['discount_authorization' => ['user_id' => $supervisor->id, 'pin' => '1470']]))
            ->assertCreated()
            ->assertJsonPath('data.authorized_by.id', $supervisor->id);
    });

    it('rejects a wrong PIN, and the retry with the right PIN succeeds', function () {
        $payload = bigDiscount(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '1111']]);

        postOrder($this->cashier, $payload)->assertUnprocessable()
            ->assertExactJson([
                'message' => 'Incorrect PIN.',
                'errors' => ['discount_authorization.pin' => ['Incorrect PIN.']],
            ]);

        expectNoSaleWritten();

        $payload['discount_authorization']['pin'] = '2468';
        postOrder($this->cashier, $payload)->assertCreated();
    });

    it('locks the approver\'s PIN after 5 wrong PINs within 15 minutes', function () {
        $wrong = fn () => bigDiscount(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '0000']]);

        foreach (range(1, 5) as $attempt) {
            postOrder($this->cashier, $wrong())->assertUnprocessable()->assertJsonValidationErrors(['discount_authorization.pin' => 'Incorrect PIN.']);
        }

        // Even the right PIN is refused while locked.
        postOrder($this->cashier, bigDiscount(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '2468']]))
            ->assertTooManyRequests()
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 15 minutes.']);

        $this->travel(14)->minutes();
        postOrder($this->cashier, $wrong())->assertTooManyRequests()
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 1 minute.']);

        $this->travel(61)->seconds();
        postOrder($this->cashier, bigDiscount(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '2468']]))
            ->assertCreated();
    });

    it('checks qualification before the lock and the lock before the PIN', function () {
        foreach (range(1, 5) as $attempt) {
            postOrder($this->cashier, bigDiscount(['discount_authorization' => ['user_id' => $this->manager->id, 'pin' => '0000']]))->assertUnprocessable();
        }

        // A non-qualifying approver is still a 422, not a 429.
        $cashier2 = withPin(userWithRole('cashier'), '2468');
        postOrder($this->cashier, bigDiscount(['discount_authorization' => ['user_id' => $cashier2->id, 'pin' => '2468']]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['discount_authorization.user_id']);
    });

    it('runs after the payment check', function () {
        postOrder($this->cashier, bigDiscount(['payments' => []]))->assertUnprocessable()
            ->assertJsonValidationErrors(['payments' => 'The payment is short by ₱217.00.'])
            ->assertJsonMissingValidationErrors(['discount_authorization']);
    });
});

describe('check 7: stock', function () {
    it('sums the demand of a product over all its lines', function () {
        $payload = simpleSale([[$this->icedTea, 30], [$this->hotDog, 1], [$this->icedTea, 25]]);

        postOrder($this->cashier, $payload)->assertUnprocessable()
            ->assertExactJson([
                'message' => 'Only 50 "Iced Tea" left in stock. (and 1 more error)',
                'errors' => [
                    'items.0.qty' => ['Only 50 "Iced Tea" left in stock.'],
                    'items.2.qty' => ['Only 50 "Iced Tea" left in stock.'],
                ],
            ]);

        expectNoSaleWritten();
        expect(stockOf($this->icedTea))->toBe(50);

        // Exactly the stock on hand is fine.
        postOrder($this->cashier, simpleSale([[$this->icedTea, 30], [$this->icedTea, 20]]))->assertCreated();
        expect(stockOf($this->icedTea))->toBe(0)
            ->and(StockMovement::query()->where('type', 'sale')->sole()->wholeQtyDelta())->toBe(-50);

        postOrder($this->cashier, simpleSale([[$this->icedTea, 1]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty' => 'Only 0 "Iced Tea" left in stock.']);
    });

    it('counts a product with no stock level as 0', function () {
        $water = Product::factory()->create(['name' => 'Bottled Water', 'track_stock' => true]);

        postOrder($this->cashier, simpleSale([[$water, 1]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty' => 'Only 0 "Bottled Water" left in stock.']);

        expect(DB::table('stock_levels')->where('product_id', $water->id)->exists())->toBeFalse();
    });

    it('does not track products without track_stock', function () {
        postOrder($this->cashier, simpleSale([[$this->hotDog, 999]]))->assertCreated();

        expect(StockMovement::query()->where('type', 'sale')->count())->toBe(0)
            ->and(DB::table('stock_levels')->where('product_id', $this->hotDog->id)->exists())->toBeFalse();
    });

    it('uses the cashier\'s branch stock only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northCashier = User::factory()->forBranch($north)->withRole('cashier')->create();
        stockUp($this->icedTea, 5, $north);

        postOrder($northCashier, simpleSale([[$this->icedTea, 6]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty' => 'Only 5 "Iced Tea" left in stock.']);

        postOrder($northCashier, simpleSale([[$this->icedTea, 5]]))->assertCreated();

        expect(stockOf($this->icedTea, $north))->toBe(0)
            ->and(stockOf($this->icedTea, $this->branch))->toBe(50);
    });

    it('runs after the discount approval', function () {
        postOrder($this->cashier, simpleSale([[$this->icedTea, 60]], [
            'discount' => ['type' => 'manual', 'kind' => 'percent', 'value' => 5000],
            'client_total_cents' => 105000,
            'payments' => [['method' => 'cash', 'amount_cents' => 105000, 'reference_no' => null]],
        ]))->assertUnprocessable()
            ->assertJsonValidationErrors(['discount_authorization'])
            ->assertJsonMissingValidationErrors(['items.0.qty']);
    });
});

describe('numbering', function () {
    it('allocates INV-{branch}-{8 digits} and a queue number from 1, per branch', function () {
        expect(sell($this->cashier, [[$this->hotDog, 1]]))->toMatchArray(['invoice_no' => 'INV-MAIN-00000001', 'queue_no' => 1])
            ->and(sell($this->cashier, [[$this->hotDog, 1]]))->toMatchArray(['invoice_no' => 'INV-MAIN-00000002', 'queue_no' => 2]);

        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northCashier = User::factory()->forBranch($north)->withRole('cashier')->create();

        expect(sell($northCashier, [[$this->hotDog, 1]]))->toMatchArray(['invoice_no' => 'INV-NORTH-00000001', 'queue_no' => 1])
            ->and(sell($this->cashier, [[$this->hotDog, 1]]))->toMatchArray(['invoice_no' => 'INV-MAIN-00000003', 'queue_no' => 3]);
    });

    it('does not use up numbers when a sale fails', function () {
        postOrder($this->cashier, simpleSale([[$this->icedTea, 51]]))->assertUnprocessable();

        expect(sell($this->cashier, [[$this->icedTea, 1]]))->toMatchArray(['invoice_no' => 'INV-MAIN-00000001', 'queue_no' => 1]);
    });

    it('resets the queue number every business day at the branch day start, never the invoice number', function () {
        Carbon::setTestNow('2026-09-25 19:59:59'); // 03:59:59 on the 26th in Manila: still the 25th
        expect(sell($this->cashier, [[$this->hotDog, 1]]))
            ->toMatchArray(['invoice_no' => 'INV-MAIN-00000001', 'queue_no' => 1, 'business_date' => '2026-09-25']);

        expect(sell($this->cashier, [[$this->hotDog, 1]]))
            ->toMatchArray(['invoice_no' => 'INV-MAIN-00000002', 'queue_no' => 2, 'business_date' => '2026-09-25']);

        Carbon::setTestNow('2026-09-25 20:00:00'); // 04:00 on the 26th in Manila: a new business day
        expect(sell($this->cashier, [[$this->hotDog, 1]]))
            ->toMatchArray(['invoice_no' => 'INV-MAIN-00000003', 'queue_no' => 1, 'business_date' => '2026-09-26', 'placed_at' => '2026-09-25T20:00:00Z']);

        Carbon::setTestNow('2026-09-26 16:00:00'); // Manila midnight: still the 26th
        expect(sell($this->cashier, [[$this->hotDog, 1]]))
            ->toMatchArray(['invoice_no' => 'INV-MAIN-00000004', 'queue_no' => 2, 'business_date' => '2026-09-26']);

        expect(DB::table('sequences')->orderBy('id')->get(['name', 'period', 'next_value'])->map(fn ($row) => (array) $row)->all())->toBe([
            ['name' => 'invoice', 'period' => '', 'next_value' => 5],
            ['name' => 'queue', 'period' => '2026-09-25', 'next_value' => 3],
            ['name' => 'queue', 'period' => '2026-09-26', 'next_value' => 3],
        ]);
    });

    it('follows the branch timezone and day start', function () {
        $this->branch->forceFill(['timezone' => 'UTC', 'day_start_time' => '06:00:00'])->save();

        Carbon::setTestNow('2026-09-25 05:59:59');
        expect(sell($this->cashier, [[$this->hotDog, 1]])['business_date'])->toBe('2026-09-24');

        Carbon::setTestNow('2026-09-25 06:00:00');
        expect(sell($this->cashier, [[$this->hotDog, 1]]))->toMatchArray(['business_date' => '2026-09-25', 'queue_no' => 1]);
    });
});

it('uses a stored order instead of writing a second one for a ULID already recorded', function () {
    $payload = exampleB();
    $first = postOrder($this->cashier, $payload)->assertCreated()->json('data');

    // As if the idempotency key had been released after the sale committed.
    IdempotencyKey::query()->delete();

    expect(postOrder($this->cashier, $payload)->assertCreated()->json('data'))->toBe($first)
        ->and(Order::query()->count())->toBe(1)
        ->and(StockMovement::query()->where('type', 'sale')->count())->toBe(1)
        ->and(stockOf($this->icedTea))->toBe(47);

    // Another branch reusing the ULID is a conflict, never a leak.
    $northCashier = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();
    IdempotencyKey::query()->delete();

    postOrder($northCashier, $payload)->assertConflict()
        ->assertExactJson(['message' => 'This Idempotency-Key was already used for a different request.']);
});

describe('category snapshot (Phase 4)', function () {
    it('snapshots each line category id, which survives a later product move and deletion', function () {
        $breakfast = $this->hotDog->category;
        $drinks = $this->icedTea->category;

        $order = sell($this->cashier, [[$this->hotDog, 1], [$this->icedTea, 2]]);

        expect(collect($order['items'])->pluck('category_id')->all())->toBe([$breakfast->id, $drinks->id])
            ->and(OrderItem::query()->orderBy('id')->pluck('category_id')->all())->toBe([$breakfast->id, $drinks->id]);

        // The product moves to another category, then is deleted along with its old category.
        $grill = Category::factory()->create(['name' => 'Grill']);
        $this->hotDog->forceFill(['category_id' => $grill->id])->save();
        $this->hotDog->delete();
        $breakfast->delete();

        $this->withToken(tokenFor($this->cashier))->getJson("/api/v1/orders/{$order['ulid']}")
            ->assertOk()
            ->assertJsonPath('data.items.0.category_id', $breakfast->id)
            ->assertJsonPath('data.items.0.category_name', 'Breakfast')
            ->assertJsonPath('data.items.1.category_id', $drinks->id);

        // A new sale of a product in the new category snapshots the new one.
        $grilled = Product::factory()->forCategory($grill)->create(['price_cents' => 1000]);
        expect(sell($this->cashier, [[$grilled, 1]])['items'][0]['category_id'])->toBe($grill->id);
    });
});

describe('table number (Core Sale revision 2)', function () {
    it('stores the table number and returns it right after queue_no on create, show and list', function () {
        $order = sell($this->cashier, [[$this->hotDog, 1]], ['table_no' => 'Patio 2']);

        expect($order['table_no'])->toBe('Patio 2')
            ->and(array_slice(array_keys($order), 3, 2))->toBe(['queue_no', 'table_no'])
            ->and(Order::query()->sole()->table_no)->toBe('Patio 2');

        $token = tokenFor($this->cashier);

        $this->withToken($token)->getJson("/api/v1/orders/{$order['ulid']}")
            ->assertOk()
            ->assertJsonPath('data.table_no', 'Patio 2');

        $summary = $this->withToken($token)->getJson('/api/v1/orders')->assertOk()->json('data.0');

        expect($summary['table_no'])->toBe('Patio 2')
            ->and(array_keys($summary))->toBe(orderSummaryKeys());
    });

    it('trims surrounding spaces', function () {
        expect(sell($this->cashier, [[$this->hotDog, 1]], ['table_no' => '  A3 '])['table_no'])->toBe('A3')
            ->and(Order::query()->sole()->table_no)->toBe('A3');
    });

    it('accepts the allowed characters up to 10', function (string $tableNo) {
        expect(sell($this->cashier, [[$this->hotDog, 1]], ['table_no' => $tableNo])['table_no'])->toBe($tableNo);
    })->with(['12', 'A3', 'Patio 2', 'VIP-1', str_repeat('9', 10)]);

    it('stores null when the table number is empty, blank, null or omitted', function (array $overrides) {
        $payload = simpleSale([[$this->hotDog, 1]], $overrides);

        postOrder($this->cashier, $payload)->assertCreated()->assertJsonPath('data.table_no', null);

        expect(Order::query()->sole()->table_no)->toBeNull();
    })->with([
        'empty' => [['table_no' => '']],
        'blank' => [['table_no' => '   ']],
        'null' => [['table_no' => null]],
        'omitted' => [[]],
    ]);

    it('rejects an invalid table number and writes nothing', function (mixed $tableNo, string $message) {
        postOrder($this->cashier, simpleSale([[$this->hotDog, 1]], ['table_no' => $tableNo]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['table_no' => $message]);

        expectNoSaleWritten();
    })->with([
        'too long' => [str_repeat('1', 11), 'The table no field must not be greater than 10 characters.'],
        'symbol' => ['12!', 'The table no field format is invalid.'],
        'slash' => ['A/3', 'The table no field format is invalid.'],
        'accent' => ['Mesá 1', 'The table no field format is invalid.'],
        'newline inside' => ["1\n2", 'The table no field format is invalid.'],
        'integer' => [12, 'The table no field must be a string.'],
        'array' => [['12'], 'The table no field must be a string.'],
    ]);
});
