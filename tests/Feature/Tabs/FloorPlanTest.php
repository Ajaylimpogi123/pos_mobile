<?php

use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\User;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->owner = userWithRole('owner', ['name' => 'Olive Owner']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);

    $this->t5 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'area' => 'Patio', 'sort_order' => 0]);
    $this->t6 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '6', 'area' => 'Patio', 'sort_order' => 1]);
    $this->t7 = DiningTable::factory()->forBranch($this->branch)->create(['name' => '7', 'area' => 'Patio', 'sort_order' => 2]);
    $this->hall = DiningTable::factory()->forBranch($this->branch)->create(['name' => '1', 'area' => null]);
});

function putLayout(User $user, array $body): TestResponse
{
    return test()->withToken(tokenFor($user))->putJson('/api/v1/admin/tables/layout', $body);
}

function layoutEntry(DiningTable $table, ?int $x, ?int $y, int $width = 2, int $height = 2, string $shape = 'rect'): array
{
    return ['id' => $table->id, 'pos_x' => $x, 'pos_y' => $y, 'width' => $width, 'height' => $height, 'shape' => $shape];
}

describe('PUT /admin/tables/layout', function () {
    it('saves an area plan and returns the area tables in the admin order', function () {
        $response = putLayout($this->owner, ['area' => 'Patio', 'tables' => [
            layoutEntry($this->t6, 4, 0, 3, 2, 'round'),
            layoutEntry($this->t5, 0, 0),
        ]])->assertOk();

        expect(array_column($response->json('data'), 'name'))->toBe(['5', '6', '7'])
            ->and(array_keys($response->json('data.0')))->toBe([
                'id', 'name', 'area', 'seats', 'pos_x', 'pos_y', 'width', 'height', 'shape', 'sort_order', 'is_active', 'updated_at',
            ])
            ->and($response->json('data.1'))->toMatchArray(['pos_x' => 4, 'pos_y' => 0, 'width' => 3, 'height' => 2, 'shape' => 'round'])
            ->and($response->json('data.2'))->toMatchArray(['pos_x' => null, 'pos_y' => null, 'width' => 2, 'height' => 2, 'shape' => 'rect'])
            ->and($this->t5->refresh()->pos_x)->toBe(0)
            ->and($this->t5->updated_by)->toBe($this->owner->id);

        $audit = lastAudit('table.layout_updated');
        expect($audit)->not->toBeNull()
            ->and($audit->changes)->toBe(['area' => 'Patio', 'count' => 2]);
    });

    it('saves the plan of the tables with no area', function () {
        putLayout($this->owner, ['area' => null, 'tables' => [layoutEntry($this->hall, 22, 14)]])
            ->assertOk()
            ->assertJsonPath('data.0.pos_x', 22)
            ->assertJsonCount(1, 'data');
    });

    it('takes a table off the plan', function () {
        $this->t5->forceFill(['pos_x' => 1, 'pos_y' => 1])->save();

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, null, null)]])
            ->assertOk()
            ->assertJsonPath('data.0.pos_x', null)
            ->assertJsonPath('data.0.pos_y', null);
    });

    it('checks the fit on the grid', function () {
        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 22, 0, 3, 2)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tables.0.pos_x' => "Table 5 doesn't fit on the plan."]);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 0, 15, 2, 2)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tables.0.pos_x' => "Table 5 doesn't fit on the plan."]);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 18, 10, 6, 6)]])->assertOk();
    });

    it('checks overlaps against tables not in the body', function () {
        $this->t6->forceFill(['pos_x' => 3, 'pos_y' => 3, 'width' => 2, 'height' => 2])->save();

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 4, 4, 2, 2, 'round')]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tables.0.pos_x' => 'Table 5 overlaps Table 6.']);

        // Touching edges don't overlap.
        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 5, 3)]])->assertOk();
    });

    it('checks overlaps between tables of the body, on the final layout', function () {
        $this->t6->forceFill(['pos_x' => 0, 'pos_y' => 0])->save();

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 0, 0), layoutEntry($this->t7, 1, 1)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'tables.0.pos_x' => 'Table 5 overlaps Table 6.',
                'tables.1.pos_x' => 'Table 7 overlaps Table 5.',
            ]);

        // Moving table 6 away in the same save frees its old cells.
        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 0, 0), layoutEntry($this->t6, 10, 0)]])->assertOk();
    });

    it('is atomic: nothing is saved when one table fails', function () {
        putLayout($this->owner, ['area' => 'Patio', 'tables' => [
            layoutEntry($this->t5, 0, 0),
            layoutEntry($this->t6, 23, 0),
        ]])->assertUnprocessable()->assertJsonValidationErrors(['tables.1.pos_x']);

        expect($this->t5->refresh()->pos_x)->toBeNull()
            ->and($this->t6->refresh()->pos_x)->toBeNull()
            ->and(lastAudit('table.layout_updated'))->toBeNull();
    });

    it('validates the body', function () {
        putLayout($this->owner, [])->assertUnprocessable()->assertJsonValidationErrors(['area', 'tables']);
        putLayout($this->owner, ['area' => 'Patio', 'tables' => []])->assertUnprocessable()->assertJsonValidationErrors(['tables']);
        putLayout($this->owner, ['area' => str_repeat('a', 31), 'tables' => [layoutEntry($this->t5, 0, 0)]])
            ->assertUnprocessable()->assertJsonValidationErrors(['area']);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 0, null)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tables.0.pos_x' => 'Place the table or leave it off the plan.']);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, null, 3)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tables.0.pos_x' => 'Place the table or leave it off the plan.']);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, -1, 0)]])
            ->assertUnprocessable()->assertJsonValidationErrors(['tables.0.pos_x']);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 0, 0, 7, 0, 'oval')]])
            ->assertUnprocessable()->assertJsonValidationErrors(['tables.0.width', 'tables.0.height', 'tables.0.shape']);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => array_fill(0, 101, layoutEntry($this->t5, null, null))])
            ->assertUnprocessable()->assertJsonValidationErrors(['tables']);
    });

    it('only takes tables of the branch in that area', function () {
        $deleted = DiningTable::factory()->forBranch($this->branch)->create(['name' => '8', 'area' => 'Patio']);
        $deleted->delete();
        $foreign = DiningTable::factory()->forBranch(Branch::factory()->create(['code' => 'OTHER']))->create(['name' => 'F1', 'area' => 'Patio']);

        putLayout($this->owner, ['area' => 'Patio', 'tables' => [
            layoutEntry($this->hall, 0, 0),
            layoutEntry($foreign, 4, 0),
            layoutEntry($deleted, 8, 0),
        ]])->assertUnprocessable()->assertJsonValidationErrors([
            'tables.0.id' => "Table 1 isn't in this area.",
            'tables.1.id' => "Table {$foreign->id} isn't in this area.",
            'tables.2.id' => "Table {$deleted->id} isn't in this area.",
        ]);

        expect($foreign->refresh()->pos_x)->toBeNull();
    });

    it('needs settings.manage and a token', function () {
        $this->putJson('/api/v1/admin/tables/layout', [])->assertUnauthorized();

        putLayout($this->cashier, ['area' => 'Patio', 'tables' => [layoutEntry($this->t5, 0, 0)]])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });
});

describe('the plan on other endpoints', function () {
    it('unplaces a table whose area changes', function () {
        $this->t5->forceFill(['pos_x' => 2, 'pos_y' => 2, 'width' => 3])->save();
        $this->t6->forceFill(['pos_x' => 6, 'pos_y' => 2])->save();

        $this->withToken(tokenFor($this->owner))->patchJson("/api/v1/admin/tables/{$this->t5->id}", ['area' => 'Hall'])
            ->assertOk()
            ->assertJsonPath('data.pos_x', null)
            ->assertJsonPath('data.pos_y', null)
            ->assertJsonPath('data.width', 3);

        // The same area (or another field) keeps the place.
        $this->withToken(tokenFor($this->owner))->patchJson("/api/v1/admin/tables/{$this->t6->id}", ['area' => 'Patio', 'seats' => 6])
            ->assertOk()
            ->assertJsonPath('data.pos_x', 6);
    });

    it('ignores the plan fields on create and update', function () {
        $this->withToken(tokenFor($this->owner))
            ->postJson('/api/v1/admin/tables', ['name' => '20', 'seats' => 2, 'pos_x' => 3, 'pos_y' => 3, 'width' => 4, 'shape' => 'round'])
            ->assertCreated()
            ->assertJsonPath('data.pos_x', null)
            ->assertJsonPath('data.width', 2)
            ->assertJsonPath('data.shape', 'rect');
    });

    it('shows the plan fields on GET /tables', function () {
        setDineIn($this->branch);
        $this->t5->forceFill(['pos_x' => 1, 'pos_y' => 2, 'width' => 3, 'height' => 1, 'shape' => 'round'])->save();

        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/tables')
            ->assertOk()
            ->assertJsonPath('data.1.name', '5')
            ->assertJsonPath('data.1.pos_x', 1)
            ->assertJsonPath('data.1.pos_y', 2)
            ->assertJsonPath('data.1.width', 3)
            ->assertJsonPath('data.1.height', 1)
            ->assertJsonPath('data.1.shape', 'round');
    });
});
