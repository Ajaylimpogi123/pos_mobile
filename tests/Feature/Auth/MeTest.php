<?php

use App\Models\PersonalAccessToken;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    $this->manager = User::factory()->forBranch($this->branch)->withRole('manager')->create([
        'email' => 'manager@pos.test',
    ]);
});

function loginManager(): string
{
    return test()->postJson('/api/v1/auth/login', [
        'email' => 'manager@pos.test',
        'password' => 'password',
    ])->assertOk()->json('data.token');
}

it('returns the AuthUser for the current token, with no device key', function () {
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
        ->assertJsonMissingPath('data.device')
        ->assertJsonPath('data.permissions', [
            'customer.manage', 'discount.apply', 'discount.override', 'inventory.adjust', 'order.review', 'product.manage',
            'purchase.receive', 'purchase.request',
            'report.view', 'report.zread', 'sale.create', 'sale.refund', 'sale.void',
            'settings.manage', 'shift.close', 'shift.open', 'supplier.manage', 'user.manage',
        ]);

    expect(array_keys($response->json('data')))
        ->toBe(['id', 'name', 'email', 'is_active', 'last_login_at', 'role', 'branch', 'permissions'])
        ->and($response->json('data.last_login_at'))->toBeString();
});

it('accepts a device-less token issued outside login', function () {
    $token = $this->manager->createToken('legacy')->plainTextToken;

    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $this->manager->id);
    expect(PersonalAccessToken::query()->count())->toBe(1);
});

it('returns all 21 permissions, sorted, for an owner', function () {
    $owner = User::factory()->forBranch($this->branch)->withRole('owner')->create();

    $permissions = $this->withToken(tokenFor($owner))
        ->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.last_login_at', null)
        ->json('data.permissions');

    $sorted = $permissions;
    sort($sorted);

    expect($permissions)->toHaveCount(21)->toBe($sorted)->toContain('branch.all')->toContain('purchase.approve')->toContain('purchase.approve_own')->toContain('customer.manage');
});

it('returns an empty permissions array for a role without permissions', function () {
    $user = User::factory()->forBranch($this->branch)->create();

    $this->withToken(tokenFor($user))
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
    $this->app['auth']->forgetGuards();

    $this->manager->update(['is_active' => false]);

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);

    expect(PersonalAccessToken::query()->count())->toBe(0);

    // Reactivating the user does not bring the revoked token back.
    $this->manager->update(['is_active' => true]);
    $this->app['auth']->forgetGuards();
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('returns 401 and revokes the token after the user is soft-deleted', function () {
    $token = loginManager();

    $this->manager->delete();

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);

    expect(PersonalAccessToken::query()->count())->toBe(0);

    // Restoring the user does not bring the revoked token back.
    $this->manager->restore();
    $this->app['auth']->forgetGuards();
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});
