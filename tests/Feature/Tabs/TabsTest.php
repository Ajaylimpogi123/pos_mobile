<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\TabItemCancellation;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\UniqueConstraintViolationException;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    setDineIn($this->branch);

    Carbon::setTestNow('2026-10-13 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');

    $mains = Category::factory()->create(['name' => 'Mains']);
    $this->sisig = Product::factory()->forCategory($mains)->create(['name' => 'Sisig', 'sku' => 'MN-001', 'price_cents' => 22500]);
    $this->rice = Product::factory()->forCategory($mains)->create(['name' => 'Rice', 'price_cents' => 2500, 'is_vatable' => false]);
    $this->beer = Product::factory()->forCategory($mains)->create(['name' => 'Beer', 'price_cents' => 9000, 'track_stock' => true]);

    $this->table5 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'area' => 'Patio', 'seats' => 4]);
    $this->table7 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '7', 'area' => 'Patio', 'seats' => 2, 'sort_order' => 1]);
});

afterEach(function () {
    Carbon::setTestNow();
});

describe('dine-in gate, auth and permissions', function () {
    it('returns 409 on every tables and tab endpoint while dine-in is off', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        setDineIn($this->branch, false);
        $off = ['message' => 'Dine-in tables are turned off in Settings.'];

        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tables')->assertConflict()->assertExactJson($off);
        $this->withToken(tokenFor($this->carla))->getJson("/api/v1/tabs/{$tab['ulid']}")->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->table7->id])->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'PATCH', "/api/v1/tabs/{$tab['ulid']}", ['guests' => 2])->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => []])->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/settle", settleBody(0))->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/close")->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", ['table_id' => $this->table7->id])->assertConflict()->assertExactJson($off);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/merge", ['into_ulid' => newUlid()])->assertConflict()->assertExactJson($off);
    });

    it('needs a token', function () {
        $this->getJson('/api/v1/tables')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
        $this->postJson('/api/v1/tabs', [])->assertUnauthorized();
        $this->getJson('/api/v1/tabs/'.newUlid())->assertUnauthorized();
        $this->postJson('/api/v1/tabs/'.newUlid().'/settle', [])->assertUnauthorized();
    });

    it('needs sale.create', function () {
        $viewer = userWithRole('cashier');
        $viewer->forceFill(['role_id' => customRole('viewer', ['report.view'])->id])->save();
        $tab = openTabAt($this->carla, $this->table5->id);

        $this->withToken(tokenFor($viewer))->getJson('/api/v1/tables')->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        tabRequest($viewer, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->table7->id])->assertForbidden();
        tabRequest($viewer, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => []])->assertForbidden();
        tabRequest($viewer, 'POST', "/api/v1/tabs/{$tab['ulid']}/settle", settleBody(0))->assertForbidden();
        tabRequest($viewer, 'POST', "/api/v1/tabs/{$tab['ulid']}/close")->assertForbidden();
    });
});

describe('GET /tables', function () {
    it('lists the active tables with their open tab summary', function () {
        DiningTable::factory()->forBranch($this->branch)->inactive()->create(['name' => '9']);
        DiningTable::factory()->forBranch(Branch::factory()->create(['code' => 'OTHER']))->create(['name' => '1']);

        $tab = openTabAt($this->carla, $this->table5->id, ['guests' => 3]);
        sendRound($this->carla, $tab['ulid'], [[$this->sisig, 2], [$this->rice, 3]]);
        sendRound($this->carla, $tab['ulid'], [[$this->sisig, 1]]);

        $response = $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tables')->assertOk()
            ->assertJsonStructure(['data', 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor']]);

        expect($response->json('data'))->toHaveCount(2)
            ->and($response->json('meta.per_page'))->toBe(100)
            ->and(array_keys($response->json('data.0')))->toBe(['id', 'name', 'area', 'seats', 'tab'])
            ->and($response->json('data.0.tab'))->toBe([
                'ulid' => $tab['ulid'],
                'guests' => 3,
                'opened_at' => '2026-10-13T04:00:00Z',
                'opened_by' => ['id' => $this->carla->id, 'name' => 'Carla Cashier'],
                'item_count' => 6,
                'remaining_cents' => 3 * 22500 + 3 * 2500,
                'rounds_count' => 2,
                'updated_at' => '2026-10-13T04:00:00Z',
            ])
            ->and($response->json('data.1'))->toBe(['id' => $this->table7->id, 'name' => '7', 'area' => 'Patio', 'seats' => 2, 'tab' => null]);
    });
});

describe('POST /tabs', function () {
    it('opens a tab with the table seats as default guests', function () {
        $response = tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => $ulid = newUlid(), 'table_id' => $this->table5->id])
            ->assertCreated();

        expect(array_keys($response->json('data')))->toBe(tabKeys())
            ->and($response->json('data'))->toMatchArray([
                'ulid' => $ulid,
                'status' => 'open',
                'table' => ['id' => $this->table5->id, 'name' => '5', 'area' => 'Patio'],
                'guests' => 4,
                'customer' => null,
                'notes' => null,
                'opened_at' => '2026-10-13T04:00:00Z',
                'opened_by' => ['id' => $this->carla->id, 'name' => 'Carla Cashier'],
                'closed_at' => null,
                'merged_into_ulid' => null,
                'rounds_count' => 0,
                'items' => [],
                'orders' => [],
                'remaining_cents' => 0,
            ])
            ->and(lastAudit('tab.opened'))->not->toBeNull()
            ->and(Tab::query()->sole()->open_table_id)->toBe($this->table5->id);
    });

    it('allows one open tab per table', function () {
        openTabAt($this->carla, $this->table5->id);

        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->table5->id])
            ->assertConflict()->assertExactJson(['message' => 'Table 5 already has an open bill.']);

        expect(Tab::query()->count())->toBe(1);
    });

    it('enforces one open tab per table in the database under concurrency', function () {
        $first = openTabAt($this->carla, $this->table5->id);
        $row = Tab::query()->where('ulid', $first['ulid'])->sole()->replicate()->fill([]);
        $row->ulid = newUlid();

        // A second request that passed the check at the same moment still can't insert.
        expect(fn () => $row->save())->toThrow(UniqueConstraintViolationException::class);
    });

    it('replays the same request without opening a second tab', function () {
        $body = ['ulid' => newUlid(), 'table_id' => $this->table5->id, 'guests' => 2];

        $first = tabRequest($this->carla, 'POST', '/api/v1/tabs', $body)->assertCreated();
        $replay = tabRequest($this->carla, 'POST', '/api/v1/tabs', $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($replay->json())->toBe($first->json())
            ->and(Tab::query()->count())->toBe(1);
    });

    it('validates the body', function () {
        $otherTable = DiningTable::factory()->forBranch(Branch::factory()->create(['code' => 'OTHER']))->create();
        $inactive = DiningTable::factory()->forBranch($this->branch)->inactive()->create();

        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid()])->assertUnprocessable()->assertJsonValidationErrors(['table_id']);
        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $otherTable->id])->assertUnprocessable()->assertJsonValidationErrors(['table_id']);
        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $inactive->id])->assertUnprocessable()->assertJsonValidationErrors(['table_id']);
        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->table5->id, 'guests' => 100, 'notes' => str_repeat('a', 256), 'customer_id' => 999])
            ->assertUnprocessable()->assertJsonValidationErrors(['guests', 'notes', 'customer_id']);
        tabRequest($this->carla, 'POST', '/api/v1/tabs', ['ulid' => newUlid(), 'table_id' => $this->table5->id], newUlid())
            ->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key']);
    });
});

describe('GET and PATCH /tabs/{ulid}', function () {
    it('shows a tab and is a 404 for another branch or an unknown tab', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        $otherBranch = Branch::factory()->create(['code' => 'OTHER']);
        setDineIn($otherBranch);
        $stranger = User::factory()->forBranch($otherBranch)->withRole('cashier')->create();

        $this->withToken(tokenFor($this->carla))->getJson("/api/v1/tabs/{$tab['ulid']}")->assertOk()->assertJsonPath('data.ulid', $tab['ulid']);
        $this->withToken(tokenFor($stranger))->getJson("/api/v1/tabs/{$tab['ulid']}")->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        $this->withToken(tokenFor($this->carla))->getJson('/api/v1/tabs/'.newUlid())->assertNotFound();
        tabRequest($stranger, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [['product_id' => $this->sisig->id, 'qty' => 1]]])->assertNotFound();
    });

    it('updates guests, customer and notes partially', function () {
        $tab = openTabAt($this->carla, $this->table5->id, ['notes' => 'Window']);

        tabRequest($this->carla, 'PATCH', "/api/v1/tabs/{$tab['ulid']}", ['guests' => 6])
            ->assertOk()
            ->assertJsonPath('data.guests', 6)
            ->assertJsonPath('data.notes', 'Window');

        tabRequest($this->carla, 'PATCH', "/api/v1/tabs/{$tab['ulid']}", ['guests' => 0])->assertUnprocessable()->assertJsonValidationErrors(['guests']);
    });

    it('refuses actions on a tab that is not open', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/close")->assertOk()->assertJsonPath('data.status', 'cancelled');

        $closed = ['message' => 'This bill is already closed.'];
        tabRequest($this->carla, 'PATCH', "/api/v1/tabs/{$tab['ulid']}", ['guests' => 2])->assertConflict()->assertExactJson($closed);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [['product_id' => $this->sisig->id, 'qty' => 1]]])
            ->assertConflict()->assertExactJson($closed);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/close")->assertConflict()->assertExactJson($closed);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", ['table_id' => $this->table7->id])->assertConflict()->assertExactJson($closed);
    });
});

describe('POST /tabs/{ulid}/rounds', function () {
    it('adds the round with snapshots and returns the round number', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        sendRound($this->carla, $tab['ulid'], [[$this->rice, 1]]);

        $response = sendRound($this->carla, $tab['ulid'], [[$this->sisig, 2, 'Extra spicy']]);

        expect($response['round_no'])->toBe(2)
            ->and($response['data']['rounds_count'])->toBe(2)
            ->and(array_keys($response['data']['items'][1]))->toBe(tabItemKeys())
            ->and($response['data']['items'][1])->toMatchArray([
                'round_no' => 2, 'product_id' => $this->sisig->id, 'product_name' => 'Sisig', 'category_id' => $this->sisig->category_id,
                'unit_price_cents' => 22500, 'is_vatable' => true, 'qty' => 2, 'settled_qty' => 0, 'cancelled_qty' => 0,
                'remaining_qty' => 2, 'notes' => 'Extra spicy', 'added_at' => '2026-10-13T04:00:00Z',
                'added_by' => ['id' => $this->carla->id, 'name' => 'Carla Cashier'],
            ])
            ->and($response['data']['remaining_cents'])->toBe(2500 + 45000)
            ->and(lastAudit('tab.round_sent')->changes['round_no'])->toBe(2);

        $item = TabItem::query()->where('product_id', $this->sisig->id)->sole();
        expect($item->sku)->toBe('MN-001')->and($item->category_name)->toBe('Mains');
    });

    it('replays a round without adding it twice', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        $body = ['ulid' => newUlid(), 'items' => [['product_id' => $this->sisig->id, 'qty' => 1, 'notes' => null]]];

        $first = tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", $body)->assertOk();
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", $body)->assertOk()->assertHeader('Idempotency-Replayed', 'true')
            ->assertExactJson($first->json());

        expect(TabItem::query()->count())->toBe(1);
    });

    it('runs the menu checks of a sale', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        $this->rice->forceFill(['is_available' => false])->save();
        $this->sisig->delete();

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [
            ['product_id' => $this->sisig->id, 'qty' => 1], ['product_id' => $this->rice->id, 'qty' => 1],
        ]])->assertUnprocessable()->assertJsonValidationErrors([
            'items.0.product_id' => 'This product is no longer on the menu.',
            'items.1.product_id' => '"Rice" is unavailable.',
        ]);
    });

    it('validates the items', function () {
        $tab = openTabAt($this->carla, $this->table5->id);

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => []])
            ->assertUnprocessable()->assertJsonValidationErrors(['items']);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [['product_id' => $this->sisig->id, 'qty' => 1000, 'notes' => str_repeat('a', 121)]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty', 'items.0.notes']);
    });

    it('checks stock across every open tab of the branch', function () {
        stockUp($this->beer, 5);
        $tab5 = openTabAt($this->carla, $this->table5->id);
        $tab7 = openTabAt($this->carla, $this->table7->id);
        sendRound($this->carla, $tab5['ulid'], [[$this->beer, 3]]);

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab7['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [['product_id' => $this->beer->id, 'qty' => 3]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty' => 'Only 2 "Beer" left in stock.']);

        sendRound($this->carla, $tab7['ulid'], [[$this->beer, 2]]);

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab7['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [['product_id' => $this->beer->id, 'qty' => 1]]])
            ->assertUnprocessable()->assertJsonValidationErrors(['items.0.qty' => 'Only 0 "Beer" left in stock.']);

        // Sending doesn't deplete stock.
        expect(stockOf($this->beer))->toBe(5);
    });

    it('caps a tab at 200 lines', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        $model = Tab::query()->sole();

        foreach (range(1, 199) as $i) {
            TabItem::query()->forceCreate([
                'tab_id' => $model->id, 'round_no' => 1, 'product_id' => $this->rice->id, 'product_name' => 'Rice',
                'category_id' => $this->rice->category_id, 'category_name' => 'Mains', 'unit_price_cents' => 2500,
                'is_vatable' => false, 'qty' => 1, 'added_by' => $this->carla->id, 'added_at' => now(),
            ]);
        }

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/rounds", ['ulid' => newUlid(), 'items' => [
            ['product_id' => $this->rice->id, 'qty' => 1], ['product_id' => $this->rice->id, 'qty' => 1],
        ]])->assertUnprocessable()->assertJsonValidationErrors(['items' => 'This bill has too many lines. Settle part of it first.']);

        sendRound($this->carla, $tab['ulid'], [[$this->rice, 1]]);
    });
});

describe('POST /tabs/{ulid}/items/{id}/cancel', function () {
    beforeEach(function () {
        $this->tab = openTabAt($this->carla, $this->table5->id);
        $this->item = sendRound($this->carla, $this->tab['ulid'], [[$this->sisig, 3]])['data']['items'][0];
        $this->uri = "/api/v1/tabs/{$this->tab['ulid']}/items/{$this->item['id']}/cancel";
    });

    it('lets a holder of sale.void cancel on their own authority', function () {
        $response = tabRequest($this->marco, 'POST', $this->uri, ['qty' => 2, 'reason' => 'Wrong order', 'authorization' => null])->assertOk();

        expect($response->json('data.items.0'))->toMatchArray(['cancelled_qty' => 2, 'remaining_qty' => 1])
            ->and($response->json('data.remaining_cents'))->toBe(22500);

        $cancellation = TabItemCancellation::query()->sole();
        expect($cancellation->qty)->toBe(2)
            ->and($cancellation->reason)->toBe('Wrong order')
            ->and($cancellation->cancelled_by)->toBe($this->marco->id)
            ->and($cancellation->authorized_by)->toBeNull()
            ->and(lastAudit('tab.item_cancelled')->changes['qty'])->toBe(2);
    });

    it('needs a manager PIN for a cashier', function () {
        tabRequest($this->carla, 'POST', $this->uri, ['qty' => 1, 'reason' => 'Wrong order'])
            ->assertUnprocessable()->assertJsonValidationErrors(['authorization' => 'A manager must approve this void.']);
        tabRequest($this->carla, 'POST', $this->uri, ['qty' => 1, 'reason' => 'Wrong order', 'authorization' => ['user_id' => $this->carla->id, 'pin' => '1234']])
            ->assertUnprocessable()->assertJsonValidationErrors(['authorization.user_id' => "This person can't approve voids."]);
        tabRequest($this->carla, 'POST', $this->uri, ['qty' => 1, 'reason' => 'Wrong order', 'authorization' => ['user_id' => $this->marco->id, 'pin' => '0000']])
            ->assertUnprocessable()->assertJsonValidationErrors(['authorization.pin' => 'Incorrect PIN.']);

        tabRequest($this->carla, 'POST', $this->uri, ['qty' => 1, 'reason' => 'Wrong order', 'authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']])
            ->assertOk()->assertJsonPath('data.items.0.cancelled_qty', 1);

        expect(TabItemCancellation::query()->sole()->authorized_by)->toBe($this->marco->id);
    });

    it('locks the approver PIN after 5 wrong attempts', function () {
        foreach (range(1, 5) as $i) {
            tabRequest($this->carla, 'POST', $this->uri, ['qty' => 1, 'reason' => 'x', 'authorization' => ['user_id' => $this->marco->id, 'pin' => '0000']])->assertUnprocessable();
        }

        tabRequest($this->carla, 'POST', $this->uri, ['qty' => 1, 'reason' => 'x', 'authorization' => ['user_id' => $this->marco->id, 'pin' => '2468']])->assertStatus(429);
    });

    it('validates the quantity and the reason', function () {
        tabRequest($this->marco, 'POST', $this->uri, ['qty' => 4])->assertUnprocessable()->assertJsonValidationErrors(['qty', 'reason']);
        tabRequest($this->marco, 'POST', $this->uri, ['qty' => 0, 'reason' => str_repeat('a', 256)])->assertUnprocessable()->assertJsonValidationErrors(['qty', 'reason']);
    });

    it('is a 404 for a line of another tab', function () {
        $other = openTabAt($this->carla, $this->table7->id);

        tabRequest($this->marco, 'POST', "/api/v1/tabs/{$other['ulid']}/items/{$this->item['id']}/cancel", ['qty' => 1, 'reason' => 'x'])->assertNotFound();
    });
});

describe('POST /tabs/{ulid}/close', function () {
    it('refuses while quantity remains, then cancels a tab without orders and frees the table', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        $item = sendRound($this->carla, $tab['ulid'], [[$this->sisig, 1]])['data']['items'][0];

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/close")
            ->assertConflict()->assertExactJson(['message' => 'Settle or cancel the remaining items first.']);

        tabRequest($this->marco, 'POST', "/api/v1/tabs/{$tab['ulid']}/items/{$item['id']}/cancel", ['qty' => 1, 'reason' => 'Mistake'])->assertOk();

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/close")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.closed_at', '2026-10-13T04:00:00Z');

        expect(Tab::query()->sole()->open_table_id)->toBeNull()
            ->and(lastAudit('tab.closed'))->not->toBeNull();

        openTabAt($this->carla, $this->table5->id);
    });
});
