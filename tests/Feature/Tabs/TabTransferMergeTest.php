<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\Product;
use App\Models\Tab;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    setDineIn($this->branch);

    Carbon::setTestNow('2026-10-13 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);

    $mains = Category::factory()->create(['name' => 'Mains']);
    $this->sisig = Product::factory()->forCategory($mains)->create(['name' => 'Sisig', 'price_cents' => 22500]);
    $this->rice = Product::factory()->forCategory($mains)->create(['name' => 'Rice', 'price_cents' => 2500, 'is_vatable' => false]);

    $this->table5 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'seats' => 4]);
    $this->table7 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '7', 'seats' => 2]);
    $this->table9 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '9', 'seats' => 2]);
});

afterEach(function () {
    Carbon::setTestNow();
});

describe('POST /tabs/{ulid}/transfer', function () {
    it('moves the tab to a free table and frees the old one', function () {
        $tab = openTabAt($this->carla, $this->table5->id);

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", ['table_id' => $this->table9->id])
            ->assertOk()
            ->assertJsonPath('data.table', ['id' => $this->table9->id, 'name' => '9', 'area' => null]);

        expect(Tab::query()->sole()->open_table_id)->toBe($this->table9->id)
            ->and(lastAudit('tab.transferred')->changes)->toEqual(['from' => '5', 'to' => '9']);

        openTabAt($this->carla, $this->table5->id);
    });

    it('refuses an occupied table', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        openTabAt($this->carla, $this->table7->id);

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", ['table_id' => $this->table7->id])
            ->assertConflict()->assertExactJson(['message' => 'Table 7 is occupied. Merge the bills instead.']);
    });

    it('needs an active table of the branch', function () {
        $tab = openTabAt($this->carla, $this->table5->id);
        $inactive = DiningTable::factory()->forBranch($this->branch)->inactive()->create();

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", ['table_id' => $inactive->id])
            ->assertUnprocessable()->assertJsonValidationErrors(['table_id']);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$tab['ulid']}/transfer", [])
            ->assertUnprocessable()->assertJsonValidationErrors(['table_id']);
    });
});

describe('POST /tabs/{ulid}/merge', function () {
    it('moves the remaining quantities into the target next round and closes the source', function () {
        $source = openTabAt($this->carla, $this->table5->id, ['guests' => 3]);
        $target = openTabAt($this->carla, $this->table7->id, ['guests' => 2]);
        sendRound($this->carla, $target['ulid'], [[$this->rice, 1]]);
        $sourceItems = sendRound($this->carla, $source['ulid'], [[$this->sisig, 2, 'Extra spicy'], [$this->rice, 2]])['data']['items'];

        // One rice is settled from the source first: that order stays linked to the source.
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$source['ulid']}/settle", settleBody(2500, [
            'items' => [['tab_item_id' => $sourceItems[1]['id'], 'qty' => 1, 'discount' => null, 'sc_pwd' => false]],
        ]))->assertCreated();

        // The source's price changes don't matter: the snapshots move.
        $this->sisig->forceFill(['price_cents' => 30000])->save();

        $response = tabRequest($this->carla, 'POST', "/api/v1/tabs/{$source['ulid']}/merge", ['into_ulid' => $target['ulid']])->assertOk();

        expect($response->json('data.ulid'))->toBe($target['ulid'])
            ->and($response->json('data.guests'))->toBe(5)
            ->and($response->json('data.rounds_count'))->toBe(2)
            ->and(array_map(fn (array $item) => [$item['round_no'], $item['product_name'], $item['unit_price_cents'], $item['remaining_qty'], $item['notes']], $response->json('data.items')))
            ->toBe([
                [1, 'Rice', 2500, 1, null],
                [2, 'Sisig', 22500, 2, 'Extra spicy'],
                [2, 'Rice', 2500, 1, null],
            ])
            ->and($response->json('data.remaining_cents'))->toBe(2500 + 45000 + 2500);

        $merged = $this->withToken(tokenFor($this->carla))->getJson("/api/v1/tabs/{$source['ulid']}")->assertOk();
        expect($merged->json('data.status'))->toBe('merged')
            ->and($merged->json('data.merged_into_ulid'))->toBe($target['ulid'])
            ->and($merged->json('data.remaining_cents'))->toBe(0)
            ->and($merged->json('data.orders'))->toHaveCount(1)
            ->and(Order::query()->sole()->tab_id)->toBe(Tab::query()->where('ulid', $source['ulid'])->value('id'))
            ->and(Tab::query()->where('ulid', $source['ulid'])->value('open_table_id'))->toBeNull()
            ->and(AuditLog::query()->where('action', 'tab.merged')->count())->toBe(2);

        // The target settles the moved lines at their snapshot prices.
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$target['ulid']}/settle", settleBody(50000))
            ->assertCreated()->assertJsonPath('tab.status', 'closed');
    });

    it('needs another open tab of the branch', function () {
        $source = openTabAt($this->carla, $this->table5->id);
        $closed = openTabAt($this->carla, $this->table7->id);
        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$closed['ulid']}/close")->assertOk();

        foreach ([$source['ulid'], $closed['ulid'], newUlid()] as $into) {
            tabRequest($this->carla, 'POST', "/api/v1/tabs/{$source['ulid']}/merge", ['into_ulid' => $into])
                ->assertUnprocessable()->assertJsonValidationErrors(['into_ulid']);
        }

        tabRequest($this->carla, 'POST', "/api/v1/tabs/{$closed['ulid']}/merge", ['into_ulid' => $source['ulid']])
            ->assertConflict()->assertExactJson(['message' => 'This bill is already closed.']);
    });
});
