<?php

use App\Actions\Auth\LoginAction;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    [$this->branch, $this->device] = mainBranchWithDevice();

    $this->cashier = User::factory()->forBranch($this->branch)->withRole('cashier')->create([
        'name' => 'Carla Cashier',
        'email' => 'cashier@pos.test',
    ]);
});

function loginPayload(array $overrides = []): array
{
    return array_merge([
        'email' => 'cashier@pos.test',
        'password' => 'password',
        'device_code' => 'TAB01',
        'app_version' => '1.0.0',
    ], $overrides);
}

const AUTH_USER_KEYS = ['id', 'name', 'email', 'is_active', 'last_login_at', 'role', 'branch', 'device', 'permissions'];

it('logs in and returns the token and AuthUser in the contract shape', function () {
    $this->freezeSecond();

    $response = $this->postJson('/api/v1/auth/login', loginPayload());

    $response->assertOk()
        ->assertJsonStructure([
            'data' => [
                'token',
                'token_type',
                'expires_at',
                'user' => [
                    'id', 'name', 'email', 'is_active', 'last_login_at',
                    'role' => ['id', 'slug', 'name', 'max_discount_percent', 'is_admin'],
                    'branch' => ['id', 'code', 'name', 'timezone', 'day_start_time'],
                    'device' => ['id', 'code', 'name'],
                    'permissions',
                ],
            ],
        ])
        ->assertJsonPath('data.token_type', 'Bearer')
        ->assertJsonPath('data.expires_at', now()->addHours(24)->toIso8601ZuluString())
        ->assertJsonPath('data.user.id', $this->cashier->id)
        ->assertJsonPath('data.user.name', 'Carla Cashier')
        ->assertJsonPath('data.user.email', 'cashier@pos.test')
        ->assertJsonPath('data.user.is_active', true)
        ->assertJsonPath('data.user.last_login_at', now()->toIso8601ZuluString())
        ->assertJsonPath('data.user.role.slug', 'cashier')
        ->assertJsonPath('data.user.role.name', 'Cashier')
        ->assertJsonPath('data.user.role.max_discount_percent', 10)
        ->assertJsonPath('data.user.role.is_admin', false)
        ->assertJsonPath('data.user.branch', [
            'id' => $this->branch->id,
            'code' => 'MAIN',
            'name' => 'Main Branch',
            'timezone' => 'Asia/Manila',
            'day_start_time' => '04:00',
        ])
        ->assertJsonPath('data.user.device', [
            'id' => $this->device->id,
            'code' => 'TAB01',
            'name' => 'Counter Tablet 1',
        ])
        ->assertJsonPath('data.user.permissions', ['discount.apply', 'sale.create', 'shift.close', 'shift.open']);

    expect(array_keys($response->json('data')))->toBe(['token', 'token_type', 'expires_at', 'user'])
        ->and(array_keys($response->json('data.user')))->toBe(AUTH_USER_KEYS)
        ->and($response->json('data.token'))->toMatch('/^\d+\|.+$/');

    // Side effects
    expect($this->cashier->fresh()->last_login_at->equalTo(now()))->toBeTrue();

    $device = $this->device->fresh();
    expect($device->last_seen_at->equalTo(now()))->toBeTrue()
        ->and($device->app_version)->toBe('1.0.0');

    $log = AuditLog::query()->where('action', 'auth.login')->sole();
    expect($log->actor_id)->toBe($this->cashier->id);
});

it('matches email and device_code case-insensitively', function () {
    $this->postJson('/api/v1/auth/login', loginPayload([
        'email' => 'CASHIER@POS.TEST',
        'device_code' => 'tab01',
    ]))->assertOk()->assertJsonPath('data.user.device.code', 'TAB01');
});

it('accepts a missing app_version and keeps the stored one', function () {
    $this->device->update(['app_version' => '0.9.0']);

    $payload = loginPayload();
    unset($payload['app_version']);

    $this->postJson('/api/v1/auth/login', $payload)->assertOk();

    expect($this->device->fresh()->app_version)->toBe('0.9.0');
});

it('honours AUTH_TOKEN_TTL_HOURS', function () {
    config(['pos.auth_token_ttl_hours' => 8]);
    $this->freezeSecond();

    $this->postJson('/api/v1/auth/login', loginPayload())
        ->assertOk()
        ->assertJsonPath('data.expires_at', now()->addHours(8)->toIso8601ZuluString());
});

it('binds the token to the device and revokes older tokens on the same device only', function () {
    $otherDevice = Device::factory()->for($this->branch)->create(['code' => 'TAB02']);

    $first = $this->postJson('/api/v1/auth/login', loginPayload())->assertOk()->json('data.token');
    $onOtherDevice = $this->postJson('/api/v1/auth/login', loginPayload(['device_code' => 'TAB02']))->assertOk()->json('data.token');
    $second = $this->postJson('/api/v1/auth/login', loginPayload())->assertOk()->json('data.token');

    $tokens = PersonalAccessToken::query()->where('tokenable_id', $this->cashier->id)->get();
    expect($tokens)->toHaveCount(2)
        ->and($tokens->pluck('device_id')->sort()->values()->all())
        ->toBe(collect([$this->device->id, $otherDevice->id])->sort()->values()->all());

    $this->withToken($first)->getJson('/api/v1/auth/me')->assertUnauthorized();
    $this->withToken($second)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.device.code', 'TAB01');
    $this->withToken($onOtherDevice)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.device.code', 'TAB02');
});

describe('validation (422)', function () {
    it('requires email, password and device_code', function () {
        $this->postJson('/api/v1/auth/login', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'email' => 'The email field is required.',
                'password' => 'The password field is required.',
                'device_code' => 'The device code field is required.',
            ])
            ->assertJsonMissingValidationErrors(['app_version']);
    });

    it('rejects an invalid email', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'not-an-email']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => 'The email field must be a valid email address.']);
    });

    it('rejects over-long fields', function () {
        $this->postJson('/api/v1/auth/login', loginPayload([
            'email' => str_repeat('a', 250).'@x.com',
            'password' => str_repeat('p', 256),
            'device_code' => str_repeat('D', 21),
            'app_version' => str_repeat('1', 21),
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'email' => 'The email field must not be greater than 255 characters.',
                'password' => 'The password field must not be greater than 255 characters.',
                'device_code' => 'The device code field must not be greater than 20 characters.',
                'app_version' => 'The app version field must not be greater than 20 characters.',
            ]);
    });

    it('rejects non-string fields', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => ['x'], 'device_code' => 123]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'password' => 'The password field must be a string.',
                'device_code' => 'The device code field must be a string.',
            ]);
    });
});

describe('credential checks (422, first failure wins)', function () {
    it('rejects an unknown email', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'nobody@pos.test']))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => LoginAction::MESSAGE_BAD_CREDENTIALS,
                'errors' => ['email' => ['These credentials do not match our records.']],
            ]);
    });

    it('rejects a wrong password', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'These credentials do not match our records.',
                'errors' => ['email' => ['These credentials do not match our records.']],
            ]);
    });

    it('rejects a soft-deleted user as unknown', function () {
        $this->cashier->delete();

        $this->postJson('/api/v1/auth/login', loginPayload())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => 'These credentials do not match our records.']);
    });

    it('rejects a deactivated user whose password is correct', function () {
        $this->cashier->update(['is_active' => false]);

        $this->postJson('/api/v1/auth/login', loginPayload())
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'This account has been deactivated.',
                'errors' => ['email' => ['This account has been deactivated.']],
            ]);
    });

    it('does not reveal deactivation when the password is wrong', function () {
        $this->cashier->update(['is_active' => false]);

        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => 'These credentials do not match our records.']);
    });

    it('rejects an unknown device', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['device_code' => 'NOPE']))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'This device is not registered.',
                'errors' => ['device_code' => ['This device is not registered.']],
            ]);
    });

    it('rejects a deactivated device', function () {
        $this->device->update(['is_active' => false]);

        $this->postJson('/api/v1/auth/login', loginPayload())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['device_code' => 'This device is not registered.'])
            ->assertJsonMissingValidationErrors(['email']);
    });

    it('rejects a soft-deleted device', function () {
        $this->device->delete();

        $this->postJson('/api/v1/auth/login', loginPayload())
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['device_code' => 'This device is not registered.']);
    });

    it('rejects a device from another branch', function () {
        Device::factory()->for(Branch::factory())->create(['code' => 'OTHER1']);

        $this->postJson('/api/v1/auth/login', loginPayload(['device_code' => 'OTHER1']))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => 'This device is not registered to your branch.',
                'errors' => ['device_code' => ['This device is not registered to your branch.']],
            ]);
    });

    it('reports bad credentials before an unknown device', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password', 'device_code' => 'NOPE']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email'])
            ->assertJsonMissingValidationErrors(['device_code']);
    });

    it('issues no token and writes no audit entry on failure', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))->assertUnprocessable();

        expect(PersonalAccessToken::query()->count())->toBe(0)
            ->and(AuditLog::query()->count())->toBe(0)
            ->and($this->cashier->fresh()->last_login_at)->toBeNull();
    });
});

it('rate-limits to 5 attempts per minute per email + IP', function () {
    foreach (range(1, 5) as $attempt) {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))->assertUnprocessable();
    }

    $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
        ->assertTooManyRequests()
        ->assertExactJson(['message' => 'Too Many Attempts.']);

    // Also with the correct password: still limited.
    $this->postJson('/api/v1/auth/login', loginPayload())->assertTooManyRequests();

    // The key includes the email (case-insensitive), so another email is not affected.
    $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'someone@pos.test']))->assertUnprocessable();
    $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'CASHIER@pos.test']))->assertTooManyRequests();

    // After a minute the limit resets.
    $this->travel(61)->seconds();
    $this->postJson('/api/v1/auth/login', loginPayload())->assertOk();
});
