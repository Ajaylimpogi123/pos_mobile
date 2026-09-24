<?php

use App\Models\PersonalAccessToken;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    [$this->branch, $this->device] = mainBranchWithDevice();

    $this->manager = User::factory()->forBranch($this->branch)->withRole('manager')->create([
        'email' => 'manager@pos.test',
    ]);
});

function loginManager(): string
{
    return test()->postJson('/api/v1/auth/login', [
        'email' => 'manager@pos.test',
        'password' => 'password',
        'device_code' => 'TAB01',
    ])->assertOk()->json('data.token');
}

it('returns the AuthUser for the current token', function () {
    $token = loginManager();

    $response = $this->withToken($token)->getJson('/api/v1/auth/me');

    $response->assertOk()
        ->assertJsonPath('data.id', $this->manager->id)
        ->assertJsonPath('data.email', 'manager@pos.test')
        ->assertJsonPath('data.is_active', true)
        ->assertJsonPath('data.role.slug', 'manager')
        ->assertJsonPath('data.role.is_admin', true)
        ->assertJsonPath('data.role.max_discount_percent', 100)
        ->assertJsonPath('data.branch.code', 'MAIN')
        ->assertJsonPath('data.branch.day_start_time', '04:00')
        ->assertJsonPath('data.device', ['id' => $this->device->id, 'code' => 'TAB01', 'name' => 'Counter Tablet 1'])
        ->assertJsonPath('data.permissions', [
            'discount.apply', 'discount.override', 'inventory.adjust', 'product.manage',
            'report.view', 'report.zread', 'sale.create', 'sale.refund', 'sale.void',
            'shift.close', 'shift.open', 'user.manage',
        ]);

    expect(array_keys($response->json('data')))
        ->toBe(['id', 'name', 'email', 'is_active', 'last_login_at', 'role', 'branch', 'device', 'permissions'])
        ->and($response->json('data.last_login_at'))->toBeString();
});

it('returns all 13 permissions, sorted, for an owner', function () {
    $owner = User::factory()->forBranch($this->branch)->withRole('owner')->create();

    $permissions = $this->withToken(tokenFor($owner, $this->device))
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.last_login_at', null)
        ->json('data.permissions');

    $sorted = $permissions;
    sort($sorted);

    expect($permissions)->toHaveCount(13)->toBe($sorted)->toContain('branch.all');
});

it('returns an empty permissions array for a role without permissions', function () {
    $user = User::factory()->forBranch($this->branch)->create();

    $this->withToken(tokenFor($user, $this->device))
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.permissions', []);
});

it('returns 401 without a token', function () {
    $this->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 JSON even without an Accept header', function () {
    $this->get('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 for an invalid token', function () {
    $this->withToken('999|not-a-real-token')
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 once the token has expired', function () {
    $token = loginManager();

    $this->travel(24)->hours();
    $this->travel(1)->minutes();

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 and revokes the token after the user is deactivated', function () {
    $token = loginManager();
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

    $this->manager->update(['is_active' => false]);

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);

    expect(PersonalAccessToken::query()->count())->toBe(0);

    // Reactivating the user does not bring the revoked token back.
    $this->manager->update(['is_active' => true]);
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('returns 401 and revokes the token after the device is deactivated', function () {
    $token = loginManager();

    $this->device->update(['is_active' => false]);

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);

    expect(PersonalAccessToken::query()->count())->toBe(0);
});

it('returns 401 after the device is soft-deleted', function () {
    $token = loginManager();

    $this->device->delete();

    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    expect(PersonalAccessToken::query()->count())->toBe(0);
});

it('returns 401 after the user is soft-deleted', function () {
    $token = loginManager();

    $this->manager->delete();

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 for a token that is not bound to a device', function () {
    $token = $this->manager->createToken('legacy')->plainTextToken;

    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    expect(PersonalAccessToken::query()->count())->toBe(0);
});
