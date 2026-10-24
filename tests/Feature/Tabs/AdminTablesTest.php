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
});

function adminTables(User $user, string $method, string $uri = '/api/v1/admin/tables', array $body = []): TestResponse
{
    return test()->withToken(tokenFor($user))->json($method, $uri, $body);
}

describe('GET /admin/tables', function () {
    it('lists the branch tables by area, sort order and name, in the cursor envelope', function () {
        $other = Branch::factory()->create(['code' => 'OTHER']);
        DiningTable::factory()->forBranch($other)->create(['name' => 'X1']);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => '2', 'area' => 'Patio', 'sort_order' => 1]);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => '1', 'area' => 'Patio', 'sort_order' => 1]);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => '9', 'area' => null]);
        DiningTable::factory()->forBranch($this->branch)->inactive()->create(['name' => '3', 'area' => 'Patio', 'sort_order' => 0]);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => 'Gone'])->delete();

        $response = adminTables($this->owner, 'GET')->assertOk()
            ->assertJsonStructure(['data', 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor']]);

        expect(array_column($response->json('data'), 'name'))->toBe(['9', '3', '1', '2'])
            ->and(array_keys($response->json('data.0')))->toBe(['id', 'name', 'area', 'seats', 'sort_order', 'is_active', 'updated_at'])
            ->and($response->json('data.0.area'))->toBeNull()
            ->and($response->json('data.1.is_active'))->toBeFalse()
            ->and($response->json('meta.per_page'))->toBe(100);
    });

    it('paginates past tables without an area', function () {
        DiningTable::factory()->forBranch($this->branch)->create(['name' => 'A', 'area' => null]);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => 'B', 'area' => null]);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => 'C', 'area' => 'Patio']);

        $first = adminTables($this->owner, 'GET', '/api/v1/admin/tables?per_page=1')->assertOk();
        $second = adminTables($this->owner, 'GET', '/api/v1/admin/tables?per_page=1&cursor='.$first->json('meta.next_cursor'))->assertOk();
        $third = adminTables($this->owner, 'GET', '/api/v1/admin/tables?per_page=1&cursor='.$second->json('meta.next_cursor'))->assertOk();

        expect([$first->json('data.0.name'), $second->json('data.0.name'), $third->json('data.0.name')])->toBe(['A', 'B', 'C'])
            ->and($third->json('meta.next_cursor'))->toBeNull();
    });

    it('needs a token', function () {
        $this->getJson('/api/v1/admin/tables')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
        $this->postJson('/api/v1/admin/tables', [])->assertUnauthorized();
    });

    it('needs settings.manage', function () {
        adminTables($this->cashier, 'GET')->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
    });
});

describe('POST /admin/tables', function () {
    it('creates a table with defaults and audits it', function () {
        $response = adminTables($this->owner, 'POST', body: ['name' => ' 5 ', 'area' => ' Patio ', 'seats' => 4])->assertCreated();

        expect($response->json('data'))->toMatchArray(['name' => '5', 'area' => 'Patio', 'seats' => 4, 'sort_order' => 0, 'is_active' => true]);

        $table = DiningTable::query()->sole();
        expect($table->branch_id)->toBe($this->branch->id)
            ->and(lastAudit('table.created')->changes['name'])->toEqual(['from' => null, 'to' => '5']);
    });

    it('validates the fields', function () {
        adminTables($this->owner, 'POST', body: [])->assertUnprocessable()->assertJsonValidationErrors(['name', 'seats']);
        adminTables($this->owner, 'POST', body: ['name' => 'Table#1', 'seats' => 0])->assertUnprocessable()->assertJsonValidationErrors(['name', 'seats']);
        adminTables($this->owner, 'POST', body: ['name' => '12345678901', 'seats' => 51, 'sort_order' => 10000, 'is_active' => 'x', 'area' => str_repeat('a', 31)])
            ->assertUnprocessable()->assertJsonValidationErrors(['name', 'seats', 'sort_order', 'is_active', 'area']);
    });

    it('keeps names unique among the branch non-deleted tables', function () {
        DiningTable::factory()->forBranch($this->branch)->create(['name' => '5']);
        DiningTable::factory()->forBranch($this->branch)->create(['name' => '6'])->delete();
        DiningTable::factory()->forBranch(Branch::factory()->create(['code' => 'OTHER']))->create(['name' => '7']);

        adminTables($this->owner, 'POST', body: ['name' => '5', 'seats' => 2])
            ->assertUnprocessable()->assertJsonValidationErrors(['name' => 'There is already a table named 5.']);
        adminTables($this->owner, 'POST', body: ['name' => '6', 'seats' => 2])->assertCreated();
        adminTables($this->owner, 'POST', body: ['name' => '7', 'seats' => 2])->assertCreated();
    });

    it('needs settings.manage', function () {
        adminTables($this->cashier, 'POST', body: ['name' => '5', 'seats' => 4])->assertForbidden();
    });
});

describe('PATCH and DELETE /admin/tables/{id}', function () {
    beforeEach(function () {
        $this->table = DiningTable::factory()->forBranch($this->branch)->create(['name' => '5', 'seats' => 4]);
    });

    it('updates partially and audits the changes', function () {
        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['seats' => 6, 'area' => null])
            ->assertOk()
            ->assertJsonPath('data.seats', 6)
            ->assertJsonPath('data.name', '5');

        expect(lastAudit('table.updated')->changes)->toEqual(['seats' => ['from' => 4, 'to' => 6]]);
    });

    it('rejects a taken name but allows keeping its own', function () {
        DiningTable::factory()->forBranch($this->branch)->create(['name' => '6']);

        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['name' => '6'])
            ->assertUnprocessable()->assertJsonValidationErrors(['name' => 'There is already a table named 6.']);
        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['name' => '5'])->assertOk();
    });

    it('soft-deletes and audits; a deleted table is a 404', function () {
        adminTables($this->owner, 'DELETE', "/api/v1/admin/tables/{$this->table->id}")->assertNoContent();

        expect(DiningTable::withTrashed()->find($this->table->id)->trashed())->toBeTrue()
            ->and(lastAudit('table.deleted'))->not->toBeNull();

        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['seats' => 2])
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
    });

    it('is a 404 for another branch table', function () {
        $other = DiningTable::factory()->forBranch(Branch::factory()->create(['code' => 'OTHER']))->create();

        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$other->id}", ['seats' => 2])->assertNotFound();
        adminTables($this->owner, 'DELETE', "/api/v1/admin/tables/{$other->id}")->assertNotFound();
    });

    it('refuses to delete or deactivate a table with an open tab, but allows renaming it', function () {
        setDineIn($this->branch);
        openTabAt($this->cashier, $this->table->id);

        adminTables($this->owner, 'DELETE', "/api/v1/admin/tables/{$this->table->id}")
            ->assertConflict()->assertExactJson(['message' => 'Table 5 has an open bill.']);
        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['is_active' => false])
            ->assertConflict()->assertExactJson(['message' => 'Table 5 has an open bill.']);
        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['name' => '5A'])
            ->assertOk()->assertJsonPath('data.name', '5A');
    });

    it('works while dine-in is off', function () {
        adminTables($this->owner, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['is_active' => false])->assertOk();
    });

    it('needs settings.manage', function () {
        adminTables($this->cashier, 'PATCH', "/api/v1/admin/tables/{$this->table->id}", ['seats' => 2])->assertForbidden();
        adminTables($this->cashier, 'DELETE', "/api/v1/admin/tables/{$this->table->id}")->assertForbidden();
    });
});
