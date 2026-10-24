<?php

use App\Models\Category;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tab;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    setDineIn($this->branch, serviceChargeBps: 1000);

    // 12:00 in Manila: business day 2026-10-13.
    Carbon::setTestNow('2026-10-13 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $meals = Category::factory()->create(['name' => 'Meals']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);

    // Worked example B's products.
    $this->hotDog = Product::factory()->forCategory($breakfast)->create(['name' => 'Hot Dog', 'sku' => 'BRK-002', 'price_cents' => 8000, 'cost_cents' => 3600]);
    $this->riceCake = Product::factory()->forCategory($meals)->create(['name' => 'Rice Cake', 'price_cents' => 4500, 'cost_cents' => 2000, 'is_vatable' => false]);
    $this->icedTea = Product::factory()->forCategory($drinks)->create(['name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true]);
    stockUp($this->icedTea, 50);

    $this->table5 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'seats' => 3]);

    $this->tab = openTabAt($this->carla, $this->table5->id);
    sendRound($this->carla, $this->tab['ulid'], [[$this->hotDog, 1, 'No ketchup'], [$this->riceCake, 2]]);
    $items = sendRound($this->carla, $this->tab['ulid'], [[$this->icedTea, 3]])['data']['items'];
    [$this->hotDogLine, $this->riceLine, $this->teaLine] = array_column($items, 'id');
    $this->settleUri = "/api/v1/tabs/{$this->tab['ulid']}/settle";
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Worked example B's items on the tab lines (10% off the hot dog), with ₱10.00 off the order.
 *
 * @return array<string, mixed>
 */
function exampleKBody(int $hotDogLine, int $riceLine, int $teaLine, int $total, array $overrides = []): array
{
    return settleBody($total, [
        'items' => [
            ['tab_item_id' => $hotDogLine, 'qty' => 1, 'discount' => ['type' => 'promo', 'kind' => 'percent', 'value' => 1000], 'sc_pwd' => false],
            ['tab_item_id' => $riceLine, 'qty' => 2, 'discount' => null, 'sc_pwd' => false],
            ['tab_item_id' => $teaLine, 'qty' => 3, 'discount' => null, 'sc_pwd' => false],
        ],
        'discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 1000],
        ...$overrides,
    ]);
}

describe('whole-bill settlement', function () {
    it('settles worked example K with the service charge and closes the tab', function () {
        $response = tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270))
            ->assertCreated();

        expect(array_keys($response->json()))->toBe(['data', 'tab'])
            ->and(array_keys($response->json('data')))->toBe(orderKeys())
            ->and($response->json('data'))->toMatchArray([
                'table_no' => '5',
                'tab_ulid' => $this->tab['ulid'],
                'service_charge_cents' => 2570,
                'split_count' => null,
                'subtotal_cents' => 27500,
                'line_discounts_cents' => 800,
                'discount_cents' => 1800,
                'total_cents' => 28270,
                'vatable_sales_cents' => 15212,
                'vat_amount_cents' => 1825,
                'vat_exempt_sales_cents' => 8663,
                'tendered_cents' => 28270,
                'change_cents' => 0,
                'client_total_cents' => 28270,
                'has_total_mismatch' => false,
            ])
            ->and(array_column($response->json('data.items'), 'line_total_cents'))->toBe([6930, 8663, 10107])
            ->and($response->json('data.items.0'))->toMatchArray(['product_name' => 'Hot Dog', 'sku' => 'BRK-002', 'category_name' => 'Breakfast', 'notes' => 'No ketchup'])
            ->and(array_keys($response->json('tab')))->toBe(tabKeys())
            ->and($response->json('tab'))->toMatchArray([
                'status' => 'closed',
                'closed_at' => '2026-10-13T04:00:00Z',
                'remaining_cents' => 0,
                'orders' => [['ulid' => $response->json('data.ulid'), 'invoice_no' => $response->json('data.invoice_no'), 'total_cents' => 28270]],
            ])
            ->and(array_column($response->json('tab.items'), 'settled_qty'))->toBe([1, 2, 3]);

        $order = Order::query()->sole();
        expect($order->tab_id)->toBe(Tab::query()->sole()->id)
            ->and($order->service_charge_waived)->toBeFalse()
            ->and(OrderItem::query()->orderBy('id')->pluck('tab_item_id')->all())->toBe([$this->hotDogLine, $this->riceLine, $this->teaLine])
            ->and(Tab::query()->sole()->open_table_id)->toBeNull()
            ->and(lastAudit('order.completed'))->not->toBeNull()
            ->and(lastAudit('tab.closed'))->not->toBeNull()
            ->and(stockOf($this->icedTea))->toBe(47);

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tables')->assertJsonPath('data.0.tab', null);
    });

    it('splits worked example K equally into 9424 · 9423 · 9423', function () {
        $response = tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270, [
            'split_count' => 3,
            'payments' => [
                ['method' => 'cash', 'amount_cents' => 10000, 'reference_no' => null],
                ['method' => 'gcash', 'amount_cents' => 9423, 'reference_no' => 'GC-1'],
                ['method' => 'cash', 'amount_cents' => 9423, 'reference_no' => null],
            ],
        ]))->assertCreated();

        expect($response->json('data.split_count'))->toBe(3)
            ->and($response->json('data.payments'))->toBe([
                ['method' => 'cash', 'amount_cents' => 9424, 'tendered_cents' => 10000, 'change_cents' => 576, 'reference_no' => null],
                ['method' => 'gcash', 'amount_cents' => 9423, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => 'GC-1'],
                ['method' => 'cash', 'amount_cents' => 9423, 'tendered_cents' => 9423, 'change_cents' => 0, 'reference_no' => null],
            ])
            ->and($response->json('data.tendered_cents'))->toBe(28846)
            ->and($response->json('data.change_cents'))->toBe(576);
    });

    it('checks the equal-split payments', function () {
        $body = fn (array $payments) => exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270, ['split_count' => 3, 'payments' => $payments]);
        $cash = fn (int $amount) => ['method' => 'cash', 'amount_cents' => $amount, 'reference_no' => null];

        tabRequest($this->marco, 'POST', $this->settleUri, $body([$cash(20000), $cash(9000)]))
            ->assertUnprocessable()->assertJsonValidationErrors(['payments' => 'Add one payment per share (3).']);
        tabRequest($this->marco, 'POST', $this->settleUri, $body([$cash(9424), ['method' => 'gcash', 'amount_cents' => 9000, 'reference_no' => 'GC'], $cash(9000)]))
            ->assertUnprocessable()->assertJsonValidationErrors([
                'payments.1.amount_cents' => 'This GCash payment must be exactly ₱94.23.',
                'payments.2.amount_cents' => 'The payment is short by ₱4.23.',
            ]);
        tabRequest($this->marco, 'POST', $this->settleUri, $body([$cash(9424), $cash(9423), $cash(9423)]))->assertCreated();
    });

    it('allows only one cash payment without a split', function () {
        tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270, ['payments' => [
            ['method' => 'cash', 'amount_cents' => 20000, 'reference_no' => null],
            ['method' => 'cash', 'amount_cents' => 8270, 'reference_no' => null],
        ]]))->assertUnprocessable()->assertJsonValidationErrors(['payments.1.method' => 'Only one cash payment is allowed.']);
    });

    it('waives the service charge on request', function () {
        tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 25700, ['service_charge' => false]))
            ->assertCreated()
            ->assertJsonPath('data.service_charge_cents', 0)
            ->assertJsonPath('data.total_cents', 25700);

        expect(Order::query()->sole()->service_charge_waived)->toBeTrue();
    });

    it('runs the checksum, payment and discount approval checks of a sale', function () {
        tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 25700))
            ->assertUnprocessable()->assertJsonValidationErrors(['client_total_cents' => 'The menu has changed since your last sync. Review the new total.']);
        tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270, [
            'payments' => [['method' => 'cash', 'amount_cents' => 28000, 'reference_no' => null]],
        ]))->assertUnprocessable()->assertJsonValidationErrors(['payments' => 'The payment is short by ₱2.70.']);
        // Half off everything (13750) is above a cashier's limit; S = 1375 on the rest.
        $halfOff = settleBody(15125, ['discount' => ['type' => 'manual', 'kind' => 'percent', 'value' => 5000]]);

        tabRequest($this->carla, 'POST', $this->settleUri, $halfOff)
            ->assertUnprocessable()->assertJsonValidationErrors(['discount_authorization' => 'A manager must approve this discount.']);
        tabRequest($this->carla, 'POST', $this->settleUri, [...$halfOff, 'discount_authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']])
            ->assertCreated()
            ->assertJsonPath('data.authorized_by.id', $this->marco->id)
            ->assertJsonPath('data.service_charge_cents', 1375);
    });

    it('validates the body', function () {
        tabRequest($this->carla, 'POST', $this->settleUri, ['ulid' => newUlid()])
            ->assertUnprocessable()->assertJsonValidationErrors(['shift_ulid', 'payments', 'client_total_cents']);
        tabRequest($this->carla, 'POST', $this->settleUri, settleBody(0, ['items' => [['tab_item_id' => 999999, 'qty' => 1]], 'split_count' => 11]))
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.tab_item_id' => "This item isn't on this bill.", 'split_count']);
    });

    it('replays a settlement without recording it twice', function () {
        $body = settleBody(30250);

        $first = tabRequest($this->carla, 'POST', $this->settleUri, $body)->assertCreated();
        $replay = tabRequest($this->carla, 'POST', $this->settleUri, $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->json())->toBe($first->json())
            ->and(Order::query()->count())->toBe(1);
    });

    it('settles everything remaining when items are omitted, at the snapshot prices', function () {
        // The menu changes after the rounds were sent: the guest pays the price when ordered.
        $this->hotDog->forceFill(['price_cents' => 9999, 'is_available' => false])->save();
        $this->riceCake->delete();

        // 8000 + 9000 + 10500 = 27500, plus S = 2750.
        $response = tabRequest($this->carla, 'POST', $this->settleUri, settleBody(30250))->assertCreated();

        expect(array_column($response->json('data.items'), 'unit_price_cents'))->toBe([8000, 4500, 3500])
            ->and($response->json('data.service_charge_cents'))->toBe(2750)
            ->and($response->json('tab.status'))->toBe('closed');
    });

    it('never blocks for stock at settlement', function () {
        recordMovement($this->icedTea, StockMovement::TYPE_ADJUSTMENT, -50);

        tabRequest($this->carla, 'POST', $this->settleUri, settleBody(30250))->assertCreated();

        expect(stockOf($this->icedTea))->toBe(-3);
        expectReconciled();
    });

    it('needs the marked items for SC/PWD items mode', function () {
        tabRequest($this->carla, 'POST', $this->settleUri, settleBody(30250, [
            'sc_pwd' => ['mode' => 'items', 'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA-1']], 'diners' => null, 'vat_exempt' => true],
        ]))->assertUnprocessable()->assertJsonValidationErrors(['items' => 'Tick the items for the senior citizen or PWD.']);
    });

    it('defaults the SC/PWD headcount diners to the tab guests', function () {
        $response = tabRequest($this->carla, 'POST', $this->settleUri, settleBody(0, [
            'sc_pwd' => ['mode' => 'headcount', 'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA-1']], 'vat_exempt' => true],
            'client_total_cents' => 0,
            'payments' => [],
        ]))->assertUnprocessable();

        expect($response->json('errors'))->toHaveKey('client_total_cents')
            ->and($response->json('errors'))->not->toHaveKey('sc_pwd.diners');
    });
});

describe('split by item and conflicts', function () {
    it('closes the tab with the settlement that leaves nothing remaining', function () {
        $first = tabRequest($this->carla, 'POST', $this->settleUri, settleBody(9350, [
            'items' => [['tab_item_id' => $this->hotDogLine, 'qty' => 1, 'discount' => null, 'sc_pwd' => false], ['tab_item_id' => $this->teaLine, 'qty' => 1, 'discount' => null, 'sc_pwd' => false]],
            'payments' => [['method' => 'cash', 'amount_cents' => 12650, 'reference_no' => null]],
            'client_total_cents' => 12650,
        ]))->assertCreated();

        expect($first->json('tab.status'))->toBe('open')
            ->and(array_column($first->json('tab.items'), 'remaining_qty'))->toBe([0, 2, 2]);

        $second = tabRequest($this->carla, 'POST', $this->settleUri, settleBody(17600))->assertCreated();

        expect($second->json('tab.status'))->toBe('closed')
            ->and($second->json('tab.orders'))->toHaveCount(2)
            ->and($second->json('data.invoice_no'))->not->toBe($first->json('data.invoice_no'));
    });

    it('is a 409 when another device settled the same quantity first', function () {
        $body = fn () => settleBody(9900, [
            'items' => [['tab_item_id' => $this->riceLine, 'qty' => 2, 'discount' => null, 'sc_pwd' => false]],
        ]);

        tabRequest($this->carla, 'POST', $this->settleUri, $body())->assertCreated();
        tabRequest($this->carla, 'POST', $this->settleUri, $body())
            ->assertConflict()->assertExactJson(['message' => 'This bill changed on another device. Review it again.']);
    });

    it('is a 409 once the tab is closed', function () {
        tabRequest($this->carla, 'POST', $this->settleUri, settleBody(30250))->assertCreated();

        tabRequest($this->carla, 'POST', $this->settleUri, settleBody(0))
            ->assertConflict()->assertExactJson(['message' => 'This bill is already closed.']);
    });
});

describe('refunds and sales figures', function () {
    it('returns the service charge only with the refund that leaves nothing refundable', function () {
        $installId = newUlid();
        $token = deviceToken($this->marco, $installId);
        $shift = openShift($token, $this->marco);

        $order = tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270, ['shift_ulid' => $shift['ulid']]))
            ->assertCreated()->json('data');
        [$hotDog, $rice, $tea] = array_column($order['items'], 'id');
        $cash = fn (int $amount) => [['method' => 'cash', 'amount_cents' => $amount]];

        // Partial: one iced tea (worked example C), without S.
        postRefund($token, $order['ulid'], refundBody($shift['ulid'], [[$tea, 1]], $cash(3369)))->assertCreated()
            ->assertJsonPath('data.refunds.0.amount_cents', 3369);

        // The rest: 28270 − 2570 − 3369 = 22331 of lines, plus S.
        postRefund($token, $order['ulid'], refundBody($shift['ulid'], [[$hotDog, 1], [$rice, 2], [$tea, 2]], $cash(22331)))
            ->assertUnprocessable()->assertJsonValidationErrors(['client_refund_cents']);

        $response = postRefund($token, $order['ulid'], refundBody($shift['ulid'], [[$hotDog, 1], [$rice, 2], [$tea, 2]], $cash(24901)))->assertCreated();

        expect($response->json('data.status'))->toBe('refunded')
            ->and($response->json('data.refunded_cents'))->toBe(28270)
            ->and($response->json('data.refunds.1.amount_cents'))->toBe(24901)
            ->and($response->json('data.refunds.1.vatable_sales_cents') + $response->json('data.refunds.1.vat_amount_cents') + $response->json('data.refunds.1.vat_exempt_sales_cents'))->toBe(22331);

        expectReconciled();
    });

    it('shows the service charge in the dashboard, the sales report and the shift report', function () {
        $installId = newUlid();
        $token = deviceToken($this->marco, $installId);
        $shift = openShift($token, $this->marco);

        tabRequest($this->marco, 'POST', $this->settleUri, exampleKBody($this->hotDogLine, $this->riceLine, $this->teaLine, 28270, ['shift_ulid' => $shift['ulid']]))
            ->assertCreated();

        $dashboard = $this->withToken(tokenFor($this->marco))->getJson('/api/v1/dashboard')->assertOk();
        expect($dashboard->json('data.sales.service_charge_cents') ?? $dashboard->json('sales.service_charge_cents'))->toBe(2570)
            ->and($dashboard->json('data.sales.net_sales_cents') ?? $dashboard->json('sales.net_sales_cents'))->toBe(28270);

        $report = $this->withToken(tokenFor($this->marco))->getJson('/api/v1/reports/sales?from=2026-10-13&to=2026-10-13&group_by=product')->assertOk();
        expect($report->json('data.totals.service_charge_cents'))->toBe(2570)
            ->and($report->json('data.totals.net_sales_cents'))->toBe(28270)
            ->and(array_sum(array_column($report->json('data.rows'), 'net_sales_cents')))->toBe(25700);

        $this->withToken($token)->getJson("/api/v1/shifts/{$shift['ulid']}")->assertOk()
            ->assertJsonPath('data.report.service_charge_cents', 2570)
            ->assertJsonPath('data.report.net_sales_cents', 28270);
    });
});
