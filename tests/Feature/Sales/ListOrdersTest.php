<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-25 04:00:00'); // 12:00 in Manila: business day 2026-09-25

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->cris = userWithRole('cashier', ['name' => 'Cris Cashier']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);

    $category = Category::factory()->create(['name' => 'Meals']);
    $this->meal = Product::factory()->forCategory($category)->create(['name' => 'Meal', 'price_cents' => 10000]);
    $this->drink = Product::factory()->forCategory($category)->create(['name' => 'Drink', 'price_cents' => 2500]);
});

afterEach(function () {
    Carbon::setTestNow();
});

function listOrders(User $user, string $query = ''): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/orders'.($query === '' ? '' : '?'.$query));
}

/**
 * Sell at a given UTC time.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @return array<string, mixed>
 */
function sellAt(string $at, User $user, array $lines, array $overrides = []): array
{
    Carbon::setTestNow($at);

    return sell($user, $lines, $overrides);
}

describe('GET /orders', function () {
    it('returns OrderSummary items in the cursor envelope', function () {
        $maria = Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos']);
        $order = sell($this->carla, [[$this->meal, 2], [$this->drink, 3], [$this->meal, 1]], [
            'customer_id' => $maria->id,
            'payments' => [
                ['method' => 'gcash', 'amount_cents' => 10000, 'reference_no' => 'G-1'],
                ['method' => 'cash', 'amount_cents' => 50000, 'reference_no' => null],
            ],
        ]);

        $response = listOrders($this->carla)->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
            ->and($response->json('meta.per_page'))->toBe(25)
            ->and($response->json('meta.next_cursor'))->toBeNull()
            ->and($response->json('data'))->toBe([[
                'ulid' => $order['ulid'],
                'invoice_no' => 'INV-MAIN-00000001',
                'order_no' => null,
                'queue_no' => 1,
                'table_no' => null,
                'business_date' => '2026-09-25',
                'status' => 'completed',
                'placed_at' => '2026-09-25T04:00:00Z',
                'cashier' => ['id' => $this->carla->id, 'name' => 'Carla Cashier'],
                'customer' => ['id' => $maria->id, 'full_name' => 'Maria Santos'],
                'items_count' => 6,
                'total_cents' => 37500,
                'payment_methods' => ['cash', 'gcash'],
                ...onlineOrderFields(),
                'shift_ulid' => testShiftUlid(),
                'refunded_cents' => 0,
                'has_sc_pwd' => false,
            ]]);
    });

    it('lists a walk-in sale with a null customer and one method', function () {
        sell($this->carla, [[$this->drink, 1]]);

        listOrders($this->carla)->assertOk()
            ->assertJsonPath('data.0.customer', null)
            ->assertJsonPath('data.0.payment_methods', ['cash'])
            ->assertJsonPath('data.0.items_count', 1);
    });

    it('shows a cashier only their own orders, and report.view the whole branch, newest first', function () {
        $a = sellAt('2026-09-25 01:00:00', $this->carla, [[$this->drink, 1]]);
        $b = sellAt('2026-09-25 02:00:00', $this->cris, [[$this->drink, 1]]);
        $c = sellAt('2026-09-25 03:00:00', $this->carla, [[$this->drink, 1]]);
        $d = sellAt('2026-09-25 03:00:00', $this->carla, [[$this->drink, 1]]); // same second: id breaks the tie

        $outsider = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('owner')->create();
        sellAt('2026-09-25 03:30:00', $outsider, [[$this->drink, 1]]);

        expect(collect(listOrders($this->carla)->assertOk()->json('data'))->pluck('ulid')->all())->toBe([$d['ulid'], $c['ulid'], $a['ulid']])
            ->and(collect(listOrders($this->cris)->json('data'))->pluck('ulid')->all())->toBe([$b['ulid']])
            ->and(collect(listOrders($this->manager)->json('data'))->pluck('ulid')->all())->toBe([$d['ulid'], $c['ulid'], $b['ulid'], $a['ulid']])
            ->and(collect(listOrders($outsider)->json('data'))->pluck('invoice_no')->all())->toBe(['INV-NORTH-00000001']);
    });

    it('lets report.view without sale.create see the branch\'s orders', function () {
        sell($this->carla, [[$this->drink, 1]]);
        $reporter = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('reporter', ['report.view'])->id]);

        listOrders($reporter)->assertOk()->assertJsonCount(1, 'data');
    });

    it('filters by business date', function () {
        $yesterday = sellAt('2026-09-24 19:59:59', $this->carla, [[$this->drink, 1]]); // 03:59:59 on the 25th in Manila → the 24th
        $today = sellAt('2026-09-24 20:00:00', $this->carla, [[$this->drink, 1]]);     // 04:00 on the 25th → the 25th

        expect(collect(listOrders($this->carla, 'business_date=2026-09-24')->assertOk()->json('data'))->pluck('ulid')->all())->toBe([$yesterday['ulid']])
            ->and(collect(listOrders($this->carla, 'business_date=2026-09-25')->json('data'))->pluck('ulid')->all())->toBe([$today['ulid']])
            ->and(listOrders($this->carla, 'business_date=2026-09-23')->json('data'))->toBe([]);
    });

    it('filters by cashier: anyone with report.view, otherwise only yourself', function () {
        $mine = sell($this->carla, [[$this->drink, 1]]);
        $theirs = sell($this->cris, [[$this->drink, 1]]);

        expect(collect(listOrders($this->manager, 'cashier_id='.$this->cris->id)->assertOk()->json('data'))->pluck('ulid')->all())->toBe([$theirs['ulid']])
            ->and(collect(listOrders($this->carla, 'cashier_id='.$this->carla->id)->assertOk()->json('data'))->pluck('ulid')->all())->toBe([$mine['ulid']]);

        listOrders($this->carla, 'cashier_id='.$this->cris->id)
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('searches the invoice number, case-insensitively', function () {
        foreach (range(1, 12) as $i) {
            sell($this->carla, [[$this->drink, 1]]);
        }

        expect(collect(listOrders($this->carla, 'search=inv-main-0000001')->assertOk()->json('data'))->pluck('invoice_no')->all())
            ->toBe(['INV-MAIN-00000012', 'INV-MAIN-00000011', 'INV-MAIN-00000010'])
            ->and(collect(listOrders($this->carla, 'search=00007')->json('data'))->pluck('invoice_no')->all())->toBe(['INV-MAIN-00000007'])
            ->and(listOrders($this->carla, 'search=%25')->json('data'))->toBe([]);
    });

    it('paginates with a cursor, 25 by default', function () {
        foreach (range(1, 27) as $i) {
            sellAt('2026-09-25 01:00:'.sprintf('%02d', $i), $this->carla, [[$this->drink, 1]]);
        }

        $page1 = listOrders($this->carla)->assertOk();
        expect($page1->json('data'))->toHaveCount(25)
            ->and($page1->json('data.0.invoice_no'))->toBe('INV-MAIN-00000027')
            ->and($page1->json('meta.next_cursor'))->not->toBeNull();

        $page2 = listOrders($this->carla, 'cursor='.$page1->json('meta.next_cursor'))->assertOk();
        expect(collect($page2->json('data'))->pluck('invoice_no')->all())->toBe(['INV-MAIN-00000002', 'INV-MAIN-00000001'])
            ->and($page2->json('meta.next_cursor'))->toBeNull();

        $small = listOrders($this->carla, 'per_page=10&business_date=2026-09-25')->assertOk();
        expect($small->json('data'))->toHaveCount(10)
            ->and($small->json('meta.per_page'))->toBe(10)
            ->and($small->json('links.next'))->toContain('business_date=2026-09-25');
    });

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/orders')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 403 without sale.create or report.view, before validation', function () {
        $nobody = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('stock-clerk', ['inventory.adjust'])->id]);

        listOrders($nobody)->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        listOrders($nobody, 'per_page=500')->assertForbidden();
    });

    it('validates the query', function (string $query, string $field) {
        listOrders($this->carla, $query)->assertUnprocessable()->assertJsonValidationErrorFor($field);
    })->with([
        'per_page too big' => ['per_page=101', 'per_page'],
        'per_page zero' => ['per_page=0', 'per_page'],
        'bad date' => ['business_date=25-09-2026', 'business_date'],
        'not a date' => ['business_date=today', 'business_date'],
        'cashier not an integer' => ['cashier_id=abc', 'cashier_id'],
        'search too long' => ['search='.str_repeat('9', 31), 'search'],
    ]);
});

describe('GET /orders/{ulid}', function () {
    it('returns the full Order, the same as the sale response', function () {
        $sold = postOrder($this->carla, simpleSale([[$this->meal, 1], [$this->drink, 2]], ['notes' => 'Takeaway']))->assertCreated();

        $response = $this->withToken(tokenFor($this->carla))->getJson('/api/v1/orders/'.$sold->json('data.ulid'))->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(orderKeys())
            ->and($response->json('data'))->toBe($sold->json('data'));
    });

    it('accepts a lowercase ULID', function () {
        $order = sell($this->carla, [[$this->drink, 1]]);

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/orders/'.strtolower($order['ulid']))
            ->assertOk()
            ->assertJsonPath('data.ulid', $order['ulid']);
    });

    it('returns 404 for an order that is not visible, or does not exist', function () {
        $carlas = sell($this->carla, [[$this->drink, 1]]);
        $outsider = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('owner')->create();
        $north = sell($outsider, [[$this->drink, 1]]);

        // Another cashier's order, without report.view.
        $this->withToken(tokenFor($this->cris))->getJson('/api/v1/orders/'.$carlas['ulid'])
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);

        // Another branch's order, even for an owner.
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/orders/'.$north['ulid'])->assertNotFound();

        // Unknown and malformed ULIDs.
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/orders/'.newUlid())->assertNotFound();
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/orders/not-a-ulid')->assertNotFound();

        // With report.view the branch's orders are visible.
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/orders/'.$carlas['ulid'])->assertOk();
    });

    it('returns 401 without a token and 403 without sale.create or report.view', function () {
        $order = sell($this->carla, [[$this->drink, 1]]);
        $nobody = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('stock-clerk', ['inventory.adjust'])->id]);

        $this->withoutToken()->getJson('/api/v1/orders/'.$order['ulid'])->assertUnauthorized();
        $this->withToken(tokenFor($nobody))->getJson('/api/v1/orders/'.$order['ulid'])
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        $this->withToken(tokenFor($nobody))->getJson('/api/v1/orders/'.newUlid())->assertForbidden();
    });

    it('shows an order whose cashier was later deleted', function () {
        $order = sell($this->cris, [[$this->drink, 1]]);
        $this->cris->delete();

        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/orders/'.$order['ulid'])
            ->assertOk()
            ->assertJsonPath('data.cashier', ['id' => $this->cris->id, 'name' => 'Cris Cashier']);

        expect(Order::query()->count())->toBe(1);
    });
});
