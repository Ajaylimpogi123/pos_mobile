<?php

use App\Models\Branch;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    [$this->branch, $this->device] = mainBranchWithDevice();

    $this->manager = User::factory()->forBranch($this->branch)->withRole('manager')->create(['name' => 'Marco Manager']);
});

it('lists users for a manager in the exact cursor pagination shape', function () {
    $cashier = User::factory()->forBranch($this->branch)->withRole('cashier')->create([
        'name' => 'Carla Cashier',
        'email' => 'cashier@pos.test',
    ]);

    $response = $this->withToken(tokenFor($this->manager, $this->device))->getJson('/api/v1/admin/users');

    $response->assertOk()
        ->assertJsonStructure([
            'data' => [[
                'id', 'name', 'email', 'is_active', 'last_login_at',
                'role' => ['id', 'slug', 'name'],
                'created_at', 'updated_at',
            ]],
            'links' => ['first', 'last', 'prev', 'next'],
            'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor'],
        ])
        ->assertJsonPath('links', ['first' => null, 'last' => null, 'prev' => null, 'next' => null])
        ->assertJsonPath('meta.per_page', 25)
        ->assertJsonPath('meta.next_cursor', null)
        ->assertJsonPath('meta.prev_cursor', null)
        ->assertJsonPath('meta.path', url('/api/v1/admin/users'))
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0', [
            'id' => $cashier->id,
            'name' => 'Carla Cashier',
            'email' => 'cashier@pos.test',
            'is_active' => true,
            'last_login_at' => null,
            'role' => ['id' => $cashier->role_id, 'slug' => 'cashier', 'name' => 'Cashier'],
            'created_at' => $cashier->created_at->toIso8601ZuluString(),
            'updated_at' => $cashier->updated_at->toIso8601ZuluString(),
        ]);

    expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
        ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor']);
});

it('allows an owner', function () {
    $owner = User::factory()->forBranch($this->branch)->withRole('owner')->create();

    $this->withToken(tokenFor($owner, $this->device))
        ->getJson('/api/v1/admin/users')
        ->assertOk()
        ->assertJsonCount(2, 'data');
});

it('forbids a cashier', function () {
    $cashier = User::factory()->forBranch($this->branch)->withRole('cashier')->create();

    $this->withToken(tokenFor($cashier, $this->device))
        ->getJson('/api/v1/admin/users')
        ->assertForbidden()
        ->assertExactJson(['message' => 'This action is unauthorized.']);
});

it('returns 401 without a token', function () {
    $this->getJson('/api/v1/admin/users')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('only lists users of the caller\'s branch, excludes soft-deleted and includes deactivated users', function () {
    $otherBranch = Branch::factory()->create();
    $outsider = User::factory()->forBranch($otherBranch)->withRole('manager')->create(['name' => 'Aaron Outsider']);
    $inactive = User::factory()->forBranch($this->branch)->withRole('cashier')->inactive()->create(['name' => 'Ivan Inactive']);
    $deleted = User::factory()->forBranch($this->branch)->withRole('cashier')->create(['name' => 'Dora Deleted']);
    $deleted->delete();

    $response = $this->withToken(tokenFor($this->manager, $this->device))
        ->getJson('/api/v1/admin/users')
        ->assertOk();

    $ids = collect($response->json('data'))->pluck('id');

    expect($ids->all())->toBe([$inactive->id, $this->manager->id])
        ->and($ids)->not->toContain($outsider->id)
        ->and($ids)->not->toContain($deleted->id);

    expect(collect($response->json('data'))->firstWhere('id', $inactive->id)['is_active'])->toBeFalse();
});

it('orders by name then id and paginates with a cursor', function () {
    $zed = User::factory()->forBranch($this->branch)->withRole('cashier')->create(['name' => 'Zed']);
    $amy1 = User::factory()->forBranch($this->branch)->withRole('cashier')->create(['name' => 'Amy']);
    $amy2 = User::factory()->forBranch($this->branch)->withRole('cashier')->create(['name' => 'Amy']);

    $token = tokenFor($this->manager, $this->device);

    $page1 = $this->withToken($token)->getJson('/api/v1/admin/users?per_page=2')->assertOk();
    $page1->assertJsonPath('meta.per_page', 2)->assertJsonPath('meta.prev_cursor', null);
    expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$amy1->id, $amy2->id]);

    $cursor = $page1->json('meta.next_cursor');
    expect($cursor)->toBeString();

    $page2 = $this->withToken($token)->getJson('/api/v1/admin/users?per_page=2&cursor='.$cursor)->assertOk();
    expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$this->manager->id, $zed->id])
        ->and($page2->json('meta.next_cursor'))->toBeNull()
        ->and($page2->json('meta.prev_cursor'))->toBeString();
});

it('searches name or email case-insensitively', function () {
    $carla = User::factory()->forBranch($this->branch)->withRole('cashier')->create([
        'name' => 'Carla Cashier', 'email' => 'carla@pos.test',
    ]);
    $bob = User::factory()->forBranch($this->branch)->withRole('cashier')->create([
        'name' => 'Bob Builder', 'email' => 'bob.special@pos.test',
    ]);
    User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create(['name' => 'Carla Elsewhere']);

    $token = tokenFor($this->manager, $this->device);

    $byName = $this->withToken($token)->getJson('/api/v1/admin/users?search=CARLA')->assertOk();
    expect(collect($byName->json('data'))->pluck('id')->all())->toBe([$carla->id]);

    $byEmail = $this->withToken($token)->getJson('/api/v1/admin/users?search=special')->assertOk();
    expect(collect($byEmail->json('data'))->pluck('id')->all())->toBe([$bob->id]);

    $wildcard = $this->withToken($token)->getJson('/api/v1/admin/users?search=%25')->assertOk();
    expect($wildcard->json('data'))->toBe([]);
});

describe('validation (422)', function () {
    it('rejects per_page above 100', function () {
        $this->withToken(tokenFor($this->manager, $this->device))
            ->getJson('/api/v1/admin/users?per_page=101')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page' => 'The per page field must not be greater than 100.']);
    });

    it('rejects per_page below 1 and non-integers', function () {
        $token = tokenFor($this->manager, $this->device);

        $this->withToken($token)->getJson('/api/v1/admin/users?per_page=0')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page' => 'The per page field must be at least 1.']);

        $this->withToken($token)->getJson('/api/v1/admin/users?per_page=abc')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page' => 'The per page field must be an integer.']);
    });

    it('accepts per_page of exactly 100', function () {
        $this->withToken(tokenFor($this->manager, $this->device))
            ->getJson('/api/v1/admin/users?per_page=100')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 100);
    });

    it('rejects a search longer than 100 characters', function () {
        $this->withToken(tokenFor($this->manager, $this->device))
            ->getJson('/api/v1/admin/users?search='.str_repeat('a', 101))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['search' => 'The search field must not be greater than 100 characters.']);
    });
});
