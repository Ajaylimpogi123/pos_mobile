<?php

use App\Models\AuditLog;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    [$this->branch, $this->device] = mainBranchWithDevice();

    $this->cashier = User::factory()->forBranch($this->branch)->withRole('cashier')->create();
});

it('revokes the current token and returns 204 with no body', function () {
    $token = tokenFor($this->cashier, $this->device);

    $response = $this->withToken($token)->postJson('/api/v1/auth/logout');

    $response->assertNoContent();
    expect($response->getContent())->toBe('');

    expect(PersonalAccessToken::query()->count())->toBe(0);

    $log = AuditLog::query()->where('action', 'auth.logout')->sole();
    expect($log->actor_id)->toBe($this->cashier->id);

    $this->withToken($token)
        ->getJson('/api/v1/auth/me')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('revokes only the current token', function () {
    $otherDevice = Device::factory()->for($this->branch)->create();
    $current = tokenFor($this->cashier, $this->device);
    $other = tokenFor($this->cashier, $otherDevice);

    $this->withToken($current)->postJson('/api/v1/auth/logout')->assertNoContent();

    $this->withToken($other)->getJson('/api/v1/auth/me')->assertOk();
});

it('returns 401 without a token', function () {
    $this->postJson('/api/v1/auth/logout')
        ->assertUnauthorized()
        ->assertExactJson(['message' => 'Unauthenticated.']);
});

it('returns 401 when logging out twice with the same token', function () {
    $token = tokenFor($this->cashier, $this->device);

    $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();
    $this->withToken($token)->postJson('/api/v1/auth/logout')->assertUnauthorized();
});
