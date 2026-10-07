<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-28.
    Carbon::setTestNow('2026-09-28 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $mains = Category::factory()->create(['name' => 'Mains']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $snacks = Category::factory()->create(['name' => 'Snacks']);

    $this->meal = Product::factory()->forCategory($mains)->create(['name' => 'Meal', 'price_cents' => 25000, 'cost_cents' => 10000]);
    $this->icedTea = Product::factory()->forCategory($drinks)->create(['name' => 'Iced Tea', 'price_cents' => 4500, 'cost_cents' => 1500]);
    $this->platter = Product::factory()->forCategory($mains)->create(['name' => 'Platter', 'price_cents' => 80000, 'cost_cents' => 30000]);
    $this->soda = Product::factory()->forCategory($drinks)->create(['name' => 'Soda', 'price_cents' => 12000, 'cost_cents' => 4000]);
    $this->riceCake = Product::factory()->forCategory($snacks)->create(['name' => 'Rice Cake', 'price_cents' => 6000, 'cost_cents' => 2000, 'is_vatable' => false]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A POST /orders body. `$lines` are `[Product, qty, marked?, discount?]`; paid exactly in cash.
 *
 * @param  list<array{0: Product, 1: int, 2?: bool, 3?: array<string, mixed>|null}>  $lines
 * @param  array<string, mixed>|null  $scPwd
 * @return array<string, mixed>
 */
function scPwdSaleBody(array $lines, ?array $scPwd, int $total, array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'shift_ulid' => testShiftUlid(),
        'customer_id' => null,
        'notes' => null,
        'items' => array_map(fn (array $line) => [
            'product_id' => $line[0]->id,
            'qty' => $line[1],
            'discount' => $line[3] ?? null,
            'notes' => null,
            'sc_pwd' => $line[2] ?? false,
        ], $lines),
        'discount' => null,
        'sc_pwd' => $scPwd,
        'payments' => $total > 0 ? [['method' => 'cash', 'amount_cents' => $total, 'reference_no' => null]] : [],
        'client_total_cents' => $total,
        'discount_authorization' => null,
    ], $overrides);
}

/**
 * One senior citizen (OSCA-12345).
 *
 * @return array<string, mixed>
 */
function scPwdOneSenior(string $mode = 'items', ?int $diners = null, bool $vatExempt = true): array
{
    return [
        'mode' => $mode,
        'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA-12345']],
        'diners' => $diners,
        'vat_exempt' => $vatExempt,
    ];
}

/**
 * Worked example D (`vat_exempt: true`, total 46071) or F (`false`, total 48600).
 *
 * @return array<string, mixed>
 */
function scPwdExampleD(bool $vatExempt = true, array $overrides = []): array
{
    $t = test();

    return scPwdSaleBody(
        [[$t->meal, 1, true], [$t->icedTea, 1, true], [$t->meal, 1]],
        scPwdOneSenior(vatExempt: $vatExempt),
        $vatExempt ? 46071 : 48600,
        $overrides,
    );
}

/**
 * Worked example E (`headcount`, 4 diners, 1 senior, VAT exempt; total 102271).
 *
 * @return array<string, mixed>
 */
function scPwdExampleE(array $overrides = []): array
{
    $t = test();

    return scPwdSaleBody(
        [[$t->platter, 1], [$t->soda, 2], [$t->riceCake, 1]],
        scPwdOneSenior('headcount', 4),
        102271,
        $overrides,
    );
}

/**
 * Example D as an OfflineOrder rung up by Carla.
 *
 * @return array<string, mixed>
 */
function scPwdOfflineD(array $overrides = []): array
{
    $t = test();
    $order = offlineOrder($t->carla, [[$t->meal, 1], [$t->icedTea, 1], [$t->meal, 1]]);
    $order['items'][0]['sc_pwd'] = true;
    $order['items'][1]['sc_pwd'] = true;

    return array_replace($order, [
        'sc_pwd' => scPwdOneSenior(),
        'payments' => [['method' => 'cash', 'amount_cents' => 46071, 'reference_no' => null]],
        'client_total_cents' => 46071,
    ], $overrides);
}

/**
 * Sell a body in the test's open shift and return its Order.
 *
 * @return array<string, mixed>
 */
function scPwdSellInShift(array $body): array
{
    return postOrder(test()->carla, [...$body, 'shift_ulid' => test()->shift['ulid']])->assertCreated()->json('data');
}

/**
 * The order's first refund: a full-cash refund of the given `[order_item_id, qty]` lines.
 *
 * @param  array<string, mixed>  $order
 * @param  list<array{0: int, 1: int}>  $lines
 * @return array<string, mixed> The Refund
 */
function scPwdRefund(array $order, array $lines, int $amount): array
{
    return postRefund(test()->marcoToken, $order['ulid'], refundBody(test()->shift['ulid'], $lines, [['method' => 'cash', 'amount_cents' => $amount]]))
        ->assertCreated()
        ->json('data.refunds.0');
}

/**
 * Example D's body with one invalid change (the validation dataset).
 *
 * @return array<string, mixed>
 */
function scPwdInvalidBody(string $case): array
{
    $body = scPwdExampleD();
    $promo = ['type' => 'promo', 'kind' => 'amount', 'value' => 100];

    match ($case) {
        'mode missing' => $body['sc_pwd'] = array_diff_key($body['sc_pwd'], ['mode' => true]),
        'mode unknown' => $body['sc_pwd']['mode'] = 'table',
        'persons missing' => $body['sc_pwd'] = array_diff_key($body['sc_pwd'], ['persons' => true]),
        'persons empty' => $body['sc_pwd']['persons'] = [],
        'persons above 10' => $body['sc_pwd']['persons'] = array_map(fn (int $i) => ['type' => 'pwd', 'id_no' => "PWD-{$i}"], range(1, 11)),
        'type unknown' => $body['sc_pwd']['persons'][0]['type'] = 'veteran',
        'type missing' => $body['sc_pwd']['persons'][0] = ['id_no' => 'OSCA-12345'],
        'id_no missing' => $body['sc_pwd']['persons'][0] = ['type' => 'senior_citizen'],
        'id_no too long' => $body['sc_pwd']['persons'][0]['id_no'] = str_repeat('1', 31),
        'id_no bad characters' => $body['sc_pwd']['persons'][0]['id_no'] = 'OSCA#123',
        'diners in items mode' => $body['sc_pwd']['diners'] = 4,
        'vat_exempt missing' => $body['sc_pwd'] = array_diff_key($body['sc_pwd'], ['vat_exempt' => true]),
        'vat_exempt not boolean' => $body['sc_pwd']['vat_exempt'] = 'yes',
        'line mark not boolean' => $body['items'][0]['sc_pwd'] = 'maybe',
        'empty sc_pwd object' => $body['sc_pwd'] = [],
    };

    return $body;
}

describe('POST /orders with SC/PWD', function () {
    it('completes worked example D and returns every SC/PWD field', function () {
        $payload = scPwdExampleD();

        $response = postOrder($this->carla, $payload)->assertCreated();
        $items = OrderItem::query()->orderBy('id')->pluck('id')->all();

        expect(array_keys($response->json('data')))->toBe(orderKeys())
            ->and(array_keys($response->json('data.items.0')))->toBe(orderItemKeys())
            ->and($response->json('data.sc_pwd'))->toBe([
                'mode' => 'items',
                'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA-12345']],
                'diners' => null,
                'vat_exempt' => true,
                'vat_relief_cents' => 3161,
                'discount_cents' => 5268,
            ]);

        $response->assertJsonPath('data.subtotal_cents', 54500)
            ->assertJsonPath('data.line_discounts_cents', 0)
            ->assertJsonPath('data.order_discount', null)
            ->assertJsonPath('data.discount_cents', 8429)
            ->assertJsonPath('data.total_cents', 46071)
            ->assertJsonPath('data.vatable_sales_cents', 22321)
            ->assertJsonPath('data.vat_amount_cents', 2679)
            ->assertJsonPath('data.vat_exempt_sales_cents', 21071)
            ->assertJsonPath('data.authorized_by', null)
            ->assertJsonPath('data.has_total_mismatch', false);

        $lines = array_map(fn (array $item) => [
            $item['id'], $item['gross_cents'], $item['line_discount_cents'], $item['order_discount_share_cents'],
            $item['sc_pwd'], $item['sc_pwd_eligible_cents'], $item['sc_pwd_vat_relief_cents'], $item['sc_pwd_discount_cents'],
            $item['line_total_cents'],
        ], $response->json('data.items'));

        expect($lines)->toBe([
            [$items[0], 25000, 0, 0, true, 25000, 2679, 4464, 17857],
            [$items[1], 4500, 0, 0, true, 4500, 482, 804, 3214],
            [$items[2], 25000, 0, 0, false, 0, 0, 0, 25000],
        ]);

        // Stored as returned.
        $order = Order::query()->sole();
        expect($order->sc_pwd_mode)->toBe('items')
            ->and($order->sc_pwd_diners)->toBeNull()
            ->and($order->sc_pwd_vat_exempt)->toBeTrue()
            ->and($order->sc_pwd_persons)->toBe([['type' => 'senior_citizen', 'id_no' => 'OSCA-12345']])
            ->and($order->sc_pwd_vat_relief_cents)->toBe(3161)
            ->and($order->sc_pwd_discount_cents)->toBe(5268);

        // The audit has the mode and the persons count, never the ID numbers.
        $audit = AuditLog::query()->where('action', 'order.completed')->sole();
        expect(ksortDeep($audit->changes))->toBe([
            'authorized_by' => null,
            'invoice_no' => 'INV-MAIN-00000001',
            'sc_pwd' => ['mode' => 'items', 'persons_count' => 1],
            'total_cents' => 46071,
        ])
            ->and(str_contains(json_encode($audit->changes), 'OSCA'))->toBeFalse();
    });

    it('completes worked example F (vat_exempt false): only the 20% comes off and the lines stay VAT-able', function () {
        $response = postOrder($this->carla, scPwdExampleD(false))->assertCreated();

        $response->assertJsonPath('data.sc_pwd.vat_exempt', false)
            ->assertJsonPath('data.sc_pwd.vat_relief_cents', 0)
            ->assertJsonPath('data.sc_pwd.discount_cents', 5900)
            ->assertJsonPath('data.discount_cents', 5900)
            ->assertJsonPath('data.total_cents', 48600)
            ->assertJsonPath('data.vatable_sales_cents', 43393)
            ->assertJsonPath('data.vat_amount_cents', 5207)
            ->assertJsonPath('data.vat_exempt_sales_cents', 0);

        expect(array_column($response->json('data.items'), 'sc_pwd_discount_cents'))->toBe([5000, 900, 0])
            ->and(array_column($response->json('data.items'), 'line_total_cents'))->toBe([20000, 3600, 25000]);
    });

    it('completes worked example E (headcount): every line gets its share', function () {
        $response = postOrder($this->carla, scPwdExampleE())->assertCreated();

        $response->assertJsonPath('data.sc_pwd', [
            'mode' => 'headcount',
            'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA-12345']],
            'diners' => 4,
            'vat_exempt' => true,
            'vat_relief_cents' => 2786,
            'discount_cents' => 4943,
        ])
            ->assertJsonPath('data.subtotal_cents', 110000)
            ->assertJsonPath('data.discount_cents', 7729)
            ->assertJsonPath('data.total_cents', 102271)
            ->assertJsonPath('data.vatable_sales_cents', 69643)
            ->assertJsonPath('data.vat_amount_cents', 8357)
            ->assertJsonPath('data.vat_exempt_sales_cents', 24271);

        $items = $response->json('data.items');
        expect(array_column($items, 'sc_pwd'))->toBe([true, true, true])
            ->and(array_column($items, 'sc_pwd_eligible_cents'))->toBe([20000, 6000, 1500])
            ->and(array_column($items, 'sc_pwd_vat_relief_cents'))->toBe([2143, 643, 0])
            ->and(array_column($items, 'sc_pwd_discount_cents'))->toBe([3572, 1071, 300])
            ->and(array_column($items, 'line_total_cents'))->toBe([74285, 22286, 5700])
            ->and(ksortDeep(AuditLog::query()->where('action', 'order.completed')->sole()->changes['sc_pwd']))
            ->toBe(['mode' => 'headcount', 'persons_count' => 1]);
    });

    it('accepts several persons, PWD included, sharing a meal', function () {
        $body = scPwdSaleBody([[$this->meal, 3]], [
            'mode' => 'headcount',
            'persons' => [['type' => 'senior_citizen', 'id_no' => 'OSCA 1/2026'], ['type' => 'pwd', 'id_no' => 'PWD-0002']],
            'diners' => 3,
            'vat_exempt' => false,
        ], 65000);

        // E = rhu(75000 × 2, 3) = 50000; S = 10000.
        postOrder($this->carla, $body)->assertCreated()
            ->assertJsonPath('data.sc_pwd.persons', [['type' => 'senior_citizen', 'id_no' => 'OSCA 1/2026'], ['type' => 'pwd', 'id_no' => 'PWD-0002']])
            ->assertJsonPath('data.sc_pwd.discount_cents', 10000)
            ->assertJsonPath('data.items.0.sc_pwd_eligible_cents', 50000)
            ->assertJsonPath('data.total_cents', 65000);
    });

    it('keeps a regular discount on an unmarked line in items mode', function () {
        $body = scPwdSaleBody(
            [[$this->meal, 1, true], [$this->icedTea, 1, false, ['type' => 'promo', 'kind' => 'amount', 'value' => 400]]],
            scPwdOneSenior(),
            17857 + 4100,
        );

        postOrder($this->carla, $body)->assertCreated()
            ->assertJsonPath('data.line_discounts_cents', 400)
            ->assertJsonPath('data.discount_cents', 400 + 2679 + 4464)
            ->assertJsonPath('data.total_cents', 21957);
    });

    it('shows has_sc_pwd on GET /orders and the same Order on GET /orders/{ulid}', function () {
        $created = postOrder($this->carla, scPwdExampleD())->assertCreated()->json('data');
        Carbon::setTestNow('2026-09-28 04:05:00');
        postOrder($this->carla, scPwdSaleBody([[$this->meal, 1]], null, 25000))->assertCreated();

        $list = $this->withToken(tokenFor($this->carla))->getJson('/api/v1/orders')->assertOk();

        expect(array_keys($list->json('data.0')))->toBe(orderSummaryKeys())
            ->and(array_column($list->json('data'), 'has_sc_pwd'))->toBe([false, true]);

        expect($this->withToken(tokenFor($this->carla))->getJson('/api/v1/orders/'.$created['ulid'])->assertOk()->json('data'))
            ->toBe($created);
    });

    it('returns 401 without a token and 403 without sale.create', function () {
        $this->postJson('/api/v1/orders', scPwdExampleD())->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);

        $reporter = userWithRole(customRole('reporter', ['report.view'])->slug);

        postOrder($reporter, scPwdExampleD())->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });
});

describe('approval', function () {
    it('never needs a manager for SC/PWD: a cashier with a 10% limit gives 15% without a PIN', function () {
        // 8429 of 54500 is 15.5%, above Carla's 10%.
        postOrder($this->carla, scPwdExampleD())->assertCreated()
            ->assertJsonPath('data.authorized_by', null);

        expect(Order::query()->sole()->authorized_by)->toBeNull();
    });

    it('never needs a manager even when the whole bill is eligible, or the cashier lacks discount.apply', function () {
        $till = userWithRole(customRole('till', ['sale.create'])->slug);

        // One diner who is a senior: the whole bill is eligible.
        $body = scPwdSaleBody([[$this->meal, 2]], scPwdOneSenior('headcount', 1), 35714);

        postOrder($till, $body)->assertCreated()
            ->assertJsonPath('data.discount_cents', 14286)
            ->assertJsonPath('data.authorized_by', null);
    });

    it('still asks a manager for a regular discount above the limit next to SC/PWD, and counts only the regular one', function () {
        // Regular: 50% of the unmarked meal = 12500 of 50000 = 25%, above Carla's 10%.
        $half = ['type' => 'manual', 'kind' => 'percent', 'value' => 5000];
        $body = scPwdSaleBody([[$this->meal, 1, true], [$this->meal, 1, false, $half]], scPwdOneSenior(), 17857 + 12500);

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['discount_authorization' => 'A manager must approve this discount.']);

        postOrder($this->carla, [...$body, 'discount_authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']])
            ->assertCreated()
            ->assertJsonPath('data.authorized_by', ['id' => $this->marco->id, 'name' => 'Marco Manager']);
    });

    it('needs no approval when the regular discount next to SC/PWD is within the limit', function () {
        // 2500 of 50000 = 5%; with SC/PWD the order's discount_cents is 9643 (19%).
        $five = ['type' => 'promo', 'kind' => 'amount', 'value' => 2500];
        $body = scPwdSaleBody([[$this->meal, 1, true], [$this->meal, 1, false, $five]], scPwdOneSenior(), 17857 + 22500);

        postOrder($this->carla, $body)->assertCreated()
            ->assertJsonPath('data.discount_cents', 9643)
            ->assertJsonPath('data.authorized_by', null);
    });
});

describe('validation', function () {
    it('rejects an invalid SC/PWD field with 422', function (string $case, string $field) {
        postOrder($this->carla, scPwdInvalidBody($case))->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);

        expect(Order::query()->count())->toBe(0);
    })->with([
        ['mode missing', 'sc_pwd.mode'],
        ['mode unknown', 'sc_pwd.mode'],
        ['persons missing', 'sc_pwd.persons'],
        ['persons empty', 'sc_pwd.persons'],
        ['persons above 10', 'sc_pwd.persons'],
        ['type unknown', 'sc_pwd.persons.0.type'],
        ['type missing', 'sc_pwd.persons.0.type'],
        ['id_no missing', 'sc_pwd.persons.0.id_no'],
        ['id_no too long', 'sc_pwd.persons.0.id_no'],
        ['id_no bad characters', 'sc_pwd.persons.0.id_no'],
        ['diners in items mode', 'sc_pwd.diners'],
        ['vat_exempt missing', 'sc_pwd.vat_exempt'],
        ['vat_exempt not boolean', 'sc_pwd.vat_exempt'],
        ['line mark not boolean', 'items.0.sc_pwd'],
        ['empty sc_pwd object', 'sc_pwd'],
    ]);

    it('requires distinct ID numbers within the order', function () {
        $body = scPwdExampleD();
        $body['sc_pwd']['persons'] = [['type' => 'senior_citizen', 'id_no' => 'OSCA-1'], ['type' => 'pwd', 'id_no' => 'OSCA-1']];

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['sc_pwd.persons.0.id_no', 'sc_pwd.persons.1.id_no']);
    });

    it('checks the diners of a shared meal: required, at least the persons count, at most 100', function () {
        $body = scPwdExampleE();

        $body['sc_pwd']['diners'] = null;
        postOrder($this->carla, $body)->assertUnprocessable()->assertJsonValidationErrors(['sc_pwd.diners']);

        $body['sc_pwd']['persons'][] = ['type' => 'pwd', 'id_no' => 'PWD-2'];
        $body['sc_pwd']['diners'] = 1;
        postOrder($this->carla, $body)->assertUnprocessable()->assertJsonValidationErrors(['sc_pwd.diners']);

        $body['sc_pwd']['diners'] = 101;
        postOrder($this->carla, $body)->assertUnprocessable()->assertJsonValidationErrors(['sc_pwd.diners']);

        $body['sc_pwd']['diners'] = 2;
        postOrder($this->carla, $body)->assertUnprocessable()->assertJsonMissingValidationErrors(['sc_pwd.diners']);
    });

    it('rejects a line discount on a marked line', function () {
        $body = scPwdExampleD();
        $body['items'][1]['discount'] = ['type' => 'promo', 'kind' => 'amount', 'value' => 100];

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['items.1.discount' => "SC/PWD can't be combined with another discount."])
            ->assertJsonMissingValidationErrors(['items.0.discount']);
    });

    it('rejects any line discount in headcount mode', function () {
        $body = scPwdExampleE();
        $body['items'][2]['discount'] = ['type' => 'promo', 'kind' => 'amount', 'value' => 100];

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['items.2.discount' => "SC/PWD can't be combined with another discount."]);
    });

    it('rejects an order discount with SC/PWD', function () {
        postOrder($this->carla, scPwdExampleD(overrides: ['discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 100]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['discount' => "SC/PWD can't be combined with another discount."]);
    });

    it('asks to tick the items in items mode when no line is marked', function () {
        $body = scPwdExampleD();
        $body['items'][0]['sc_pwd'] = false;
        $body['items'][1]['sc_pwd'] = false;

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['items' => 'Tick the items for the senior citizen or PWD.']);
    });

    it('rejects a marked line without sc_pwd, or in headcount mode', function () {
        postOrder($this->carla, scPwdExampleD(overrides: ['sc_pwd' => null]))->assertUnprocessable()
            ->assertJsonValidationErrors([
                'items.0.sc_pwd' => 'The selected sc pwd is invalid.',
                'items.1.sc_pwd' => 'The selected sc pwd is invalid.',
            ]);

        $body = scPwdExampleE();
        $body['items'][0]['sc_pwd'] = true;

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.sc_pwd' => 'The selected sc pwd is invalid.']);
    });

    it('keeps senior_citizen and pwd invalid as a discount type', function () {
        $body = scPwdSaleBody(
            [[$this->meal, 1, false, ['type' => 'pwd', 'kind' => 'percent', 'value' => 2000]]],
            null,
            20000,
            ['discount' => ['type' => 'senior_citizen', 'kind' => 'percent', 'value' => 2000]],
        );

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors([
                'items.0.discount.type' => 'The selected type is invalid.',
                'discount.type' => 'The selected type is invalid.',
            ]);
    });

    it('reports the SC/PWD errors together with the other field errors', function () {
        $body = scPwdExampleD(overrides: ['discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 100], 'notes' => str_repeat('x', 256)]);
        $body['sc_pwd']['persons'][0]['id_no'] = 'OSCA#1';

        postOrder($this->carla, $body)->assertUnprocessable()
            ->assertJsonValidationErrors(['discount', 'notes', 'sc_pwd.persons.0.id_no']);
    });
});

describe('offline ingest', function () {
    beforeEach(function () {
        $this->deviceToken = deviceToken($this->carla);
    });

    it('accepts an SC/PWD sale without discount_over_limit and prices it as online', function () {
        $result = syncOrders($this->deviceToken, [scPwdOfflineD()])->assertOk()->json('data.0');

        expect($result['status'])->toBe('accepted')
            ->and($result['order']['needs_review'])->toBeFalse()
            ->and($result['order']['review_reasons'])->toBe([])
            ->and($result['order']['total_cents'])->toBe(46071)
            ->and($result['order']['discount_cents'])->toBe(8429)
            ->and($result['order']['sc_pwd']['vat_relief_cents'])->toBe(3161)
            ->and($result['order']['sc_pwd']['discount_cents'])->toBe(5268)
            ->and(array_column($result['order']['items'], 'sc_pwd'))->toBe([true, true, false])
            ->and(ksortDeep(lastAudit('order.completed')->changes))->toBe([
                'authorized_by' => null,
                'invoice_no' => 'INV-MAIN-00000001',
                'sc_pwd' => ['mode' => 'items', 'persons_count' => 1],
                'source' => 'offline',
                'total_cents' => 46071,
            ]);
    });

    it('still flags a regular discount above the limit next to SC/PWD', function () {
        $order = scPwdOfflineD();
        $order['items'][2]['discount'] = ['type' => 'manual', 'kind' => 'percent', 'value' => 5000];
        $order['payments'][0]['amount_cents'] = 21071 + 12500;
        $order['client_total_cents'] = 21071 + 12500;

        $result = syncOrders($this->deviceToken, [$order])->assertOk()->json('data.0');

        expect($result['status'])->toBe('accepted')
            ->and($result['order']['review_reasons'])->toBe(['discount_over_limit']);
    });

    it('rejects an OfflineOrder that combines SC/PWD with another discount, with the message', function () {
        $result = syncOrders($this->deviceToken, [scPwdOfflineD(['discount' => ['type' => 'promo', 'kind' => 'amount', 'value' => 100]])])
            ->assertOk()->json('data.0');

        expect($result['status'])->toBe('rejected')
            ->and($result['message'])->toBe("SC/PWD can't be combined with another discount.")
            ->and(Order::query()->count())->toBe(0);
    });
});

describe('voids, refunds and figures', function () {
    beforeEach(function () {
        $installId = newUlid();
        $this->token = deviceToken($this->carla, $installId);
        $this->marcoToken = deviceToken($this->marco, $installId);
        $this->shift = openShift($this->token, $this->carla);
    });

    it('refunds a marked line of a VAT-exempt sale as VAT-exempt only', function () {
        $order = scPwdSellInShift(scPwdExampleD());
        $refund = scPwdRefund($order, [[$order['items'][0]['id'], 1]], 17857);

        expect([$refund['amount_cents'], $refund['vatable_sales_cents'], $refund['vat_amount_cents'], $refund['vat_exempt_sales_cents']])
            ->toBe([17857, 0, 0, 17857]);
        expectReconciled();
    });

    it('refunds the unmarked line as fully VAT-able', function () {
        $order = scPwdSellInShift(scPwdExampleD());
        $refund = scPwdRefund($order, [[$order['items'][2]['id'], 1]], 25000);

        expect([$refund['amount_cents'], $refund['vatable_sales_cents'], $refund['vat_amount_cents'], $refund['vat_exempt_sales_cents']])
            ->toBe([25000, 22321, 2679, 0]);
    });

    it('refunds the whole SC/PWD sale with the order\'s own VAT split and exact total', function () {
        $order = scPwdSellInShift(scPwdExampleD());
        $response = postRefund($this->marcoToken, $order['ulid'], refundBody(
            $this->shift['ulid'],
            array_map(fn (array $item) => [$item['id'], 1], $order['items']),
            [['method' => 'cash', 'amount_cents' => 46071]],
        ))->assertCreated();

        $refund = $response->json('data.refunds.0');
        expect($response->json('data.status'))->toBe('refunded')
            ->and($response->json('data.refunded_cents'))->toBe(46071)
            ->and([$refund['amount_cents'], $refund['vatable_sales_cents'], $refund['vat_amount_cents'], $refund['vat_exempt_sales_cents']])
            ->toBe([46071, 22321, 2679, 21071]);
        expectReconciled();
    });

    it('splits a headcount line refunded unit by unit on its taxable part', function () {
        $order = scPwdSellInShift(scPwdExampleE());
        $sodaLine = $order['items'][1]['id'];

        // Soda: T = 22286, τ = 22286 − 4286 = 18000, n = 2.
        $first = scPwdRefund($order, [[$sodaLine, 1]], 11143);
        expect([$first['amount_cents'], $first['vatable_sales_cents'], $first['vat_amount_cents'], $first['vat_exempt_sales_cents']])
            ->toBe([11143, 8036, 964, 2143]);

        $second = postRefund($this->marcoToken, $order['ulid'], refundBody($this->shift['ulid'], [[$sodaLine, 1]], [['method' => 'cash', 'amount_cents' => 11143]]))
            ->assertCreated()->json('data.refunds.1');
        expect([$second['amount_cents'], $second['vatable_sales_cents'] + $second['vat_amount_cents'], $second['vat_exempt_sales_cents']])
            ->toBe([11143, 9000, 2143]);

        // The platter: τ = 60000 of 74285.
        $platter = postRefund($this->marcoToken, $order['ulid'], refundBody($this->shift['ulid'], [[$order['items'][0]['id'], 1]], [['method' => 'cash', 'amount_cents' => 74285]]))
            ->assertCreated()->json('data.refunds.2');
        expect([$platter['vatable_sales_cents'], $platter['vat_amount_cents'], $platter['vat_exempt_sales_cents']])
            ->toBe([53571, 6429, 14285]);
        expectReconciled();
    });

    it('refunds a marked line of a sale without VAT exemption as VAT-able (example F)', function () {
        $order = scPwdSellInShift(scPwdExampleD(false));
        $refund = scPwdRefund($order, [[$order['items'][1]['id'], 1]], 3600);

        expect([$refund['amount_cents'], $refund['vatable_sales_cents'], $refund['vat_amount_cents'], $refund['vat_exempt_sales_cents']])
            ->toBe([3600, 3214, 386, 0]);
    });

    it('counts SC/PWD in the shift report, the dashboard and the sales report, with gross − discounts = net', function () {
        $d = scPwdSellInShift(scPwdExampleD());
        scPwdSellInShift(scPwdExampleE());
        scPwdSellInShift(scPwdSaleBody([[$this->meal, 1]], null, 25000));

        $scPwd = ['sc_pwd_orders_count' => 2, 'sc_pwd_vat_relief_cents' => 3161 + 2786, 'sc_pwd_discount_cents' => 5268 + 4943];

        $report = $this->withToken(tokenFor($this->marco))->getJson("/api/v1/shifts/{$this->shift['ulid']}")->assertOk()->json('data.report');
        expect(array_keys($report))->toBe(shiftReportKeys())
            ->and($report)->toMatchArray([
                'orders_count' => 3,
                'gross_sales_cents' => 189500,
                'discounts_cents' => 8429 + 7729,
                'net_sales_cents' => 46071 + 102271 + 25000,
                'vatable_sales_cents' => 22321 + 69643 + 22321,
                'vat_amount_cents' => 2679 + 8357 + 2679,
                'vat_exempt_sales_cents' => 21071 + 24271,
                ...$scPwd,
            ])
            ->and($report['gross_sales_cents'] - $report['discounts_cents'])->toBe($report['net_sales_cents']);

        $sales = $this->withToken(tokenFor($this->marco))->getJson('/api/v1/dashboard')->assertOk()->json('data.sales');
        expect($sales)->toMatchArray(['orders_count' => 3, 'discounts_cents' => 16158, ...$scPwd])
            ->and($sales['gross_sales_cents'] - $sales['discounts_cents'])->toBe($sales['net_sales_cents']);

        foreach (['product', 'category', 'day', 'cashier'] as $group) {
            $data = $this->withToken(tokenFor($this->marco))
                ->getJson("/api/v1/reports/sales?from=2026-09-28&to=2026-09-28&group_by={$group}")
                ->assertOk()->json('data');

            expect($data['totals'])->toMatchArray([...$scPwd, 'discounts_cents' => 16158])
                ->and($data['totals']['gross_sales_cents'] - $data['totals']['discounts_cents'])->toBe($data['totals']['net_sales_cents']);

            foreach ($data['rows'] as $row) {
                expect($row['gross_sales_cents'] - $row['discounts_cents'])->toBe($row['net_sales_cents']);
            }

            expect(array_sum(array_column($data['rows'], 'discounts_cents')))->toBe(16158);
        }

        $products = collect($this->withToken(tokenFor($this->marco))
            ->getJson('/api/v1/reports/sales?from=2026-09-28&to=2026-09-28&group_by=product')->json('data.rows'))->keyBy('label');

        expect($products['Meal'])->toMatchArray(['gross_sales_cents' => 75000, 'discounts_cents' => 7143, 'net_sales_cents' => 67857])
            ->and($products['Rice Cake'])->toMatchArray(['gross_sales_cents' => 6000, 'discounts_cents' => 300, 'net_sales_cents' => 5700]);

        // A voided SC/PWD sale leaves every figure.
        postVoid($this->marcoToken, $d['ulid'], voidBody())->assertOk()->assertJsonPath('data.status', 'voided');

        $sales = $this->withToken(tokenFor($this->marco))->getJson('/api/v1/dashboard')->assertOk()->json('data.sales');
        expect($sales)->toMatchArray([
            'orders_count' => 2, 'voids_count' => 1,
            'sc_pwd_orders_count' => 1, 'sc_pwd_vat_relief_cents' => 2786, 'sc_pwd_discount_cents' => 4943,
        ]);

        $report = $this->withToken(tokenFor($this->marco))->getJson("/api/v1/shifts/{$this->shift['ulid']}")->json('data.report');
        expect($report)->toMatchArray(['sc_pwd_orders_count' => 1, 'sc_pwd_discount_cents' => 4943, 'voids_count' => 1, 'voids_cents' => 46071]);

        $totals = $this->withToken(tokenFor($this->marco))
            ->getJson('/api/v1/reports/sales?from=2026-09-28&to=2026-09-28&group_by=product')->json('data.totals');
        expect($totals)->toMatchArray(['sc_pwd_orders_count' => 1, 'sc_pwd_vat_relief_cents' => 2786, 'sc_pwd_discount_cents' => 4943]);
        expectReconciled();
    });
});
