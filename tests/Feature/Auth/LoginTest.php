<?php

use App\Actions\Auth\LoginAction;
use App\Models\AuditLog;
use App\Models\PersonalAccessToken;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

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
    ], $overrides);
}

const AUTH_USER_KEYS = ['id', 'name', 'email', 'is_active', 'last_login_at', 'role', 'branch', 'permissions'];

it('logs in and returns the token and AuthUser in the contract shape (no device)', function () {
    $this->freezeSecond();
    $updatedAt = $this->cashier->fresh()->updated_at;
    $this->travel(5)->minutes();

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
                    'permissions',
                ],
            ],
        ])
        ->assertJsonMissingPath('data.user.device')
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
        ->assertJsonPath('data.user.permissions', ['discount.apply', 'sale.create', 'shift.close', 'shift.open']);

    expect(array_keys($response->json('data')))->toBe(['token', 'token_type', 'expires_at', 'user'])
        ->and(array_keys($response->json('data.user')))->toBe(AUTH_USER_KEYS)
        ->and($response->json('data.token'))->toMatch('/^\d+\|.+$/');

    // Side effects: last_login_at is set without bumping updated_at (used for delta sync).
    $fresh = $this->cashier->fresh();
    expect($fresh->last_login_at->equalTo(now()))->toBeTrue()
        ->and($fresh->updated_at->equalTo($updatedAt))->toBeTrue();

    $token = PersonalAccessToken::query()->sole();
    $log = AuditLog::query()->where('action', 'auth.login')->sole();
    expect($log->actor_id)->toBe($this->cashier->id)
        ->and($log->subject_type)->toBe($this->cashier->getMorphClass())
        ->and($log->subject_id)->toBe($this->cashier->id)
        ->and($log->changes['token_id'])->toBe($token->id)
        ->and($log->changes)->not->toHaveKeys(['device_code', 'app_version']);
});

it('issues a token named mobile-app that is not bound to a device', function () {
    $this->postJson('/api/v1/auth/login', loginPayload())->assertOk();

    $token = PersonalAccessToken::query()->sole();
    expect($token->name)->toBe('mobile-app')
        ->and($token->device_id)->toBeNull()
        ->and($token->tokenable_id)->toBe($this->cashier->id);
});

it('matches the email case-insensitively', function () {
    $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'CASHIER@POS.TEST']))
        ->assertOk()
        ->assertJsonPath('data.user.id', $this->cashier->id);
});

it('honours AUTH_TOKEN_TTL_HOURS', function () {
    config(['pos.auth_token_ttl_hours' => 8]);
    $this->freezeSecond();

    $this->postJson('/api/v1/auth/login', loginPayload())
        ->assertOk()
        ->assertJsonPath('data.expires_at', now()->addHours(8)->toIso8601ZuluString());

    expect(PersonalAccessToken::query()->sole()->expires_at->equalTo(now()->addHours(8)))->toBeTrue();
});

it('does not revoke the user\'s other tokens: two logins yield two valid tokens', function () {
    $first = $this->postJson('/api/v1/auth/login', loginPayload())->assertOk()->json('data.token');
    $second = $this->postJson('/api/v1/auth/login', loginPayload())->assertOk()->json('data.token');

    expect($first)->not->toBe($second)
        ->and(PersonalAccessToken::query()->where('tokenable_id', $this->cashier->id)->count())->toBe(2);

    $this->withToken($first)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $this->cashier->id);
    $this->app['auth']->forgetGuards();
    $this->withToken($second)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $this->cashier->id);
});

it('ignores extra fields such as a stale device_code or app_version', function () {
    $this->postJson('/api/v1/auth/login', loginPayload([
        'device_code' => 'NOPE-NOT-A-REAL-DEVICE-CODE-AT-ALL',
        'app_version' => ['not', 'a', 'string'],
        'anything_else' => 123,
    ]))
        ->assertOk()
        ->assertJsonMissingPath('data.user.device')
        ->assertJsonPath('data.user.id', $this->cashier->id);

    expect(PersonalAccessToken::query()->sole()->device_id)->toBeNull();
});

describe('validation (422)', function () {
    it('requires email and password', function () {
        $this->postJson('/api/v1/auth/login', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'email' => 'The email field is required.',
                'password' => 'The password field is required.',
            ]);
    });

    it('reports only the email and password fields', function () {
        $errors = $this->postJson('/api/v1/auth/login', ['device_code' => 'TAB01'])
            ->assertUnprocessable()
            ->json('errors');

        expect(array_keys($errors))->toEqualCanonicalizing(['email', 'password']);
    });

    it('rejects an invalid email before checking credentials', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'not-an-email', 'password' => 'wrong-password']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => 'The email field must be a valid email address.']);
    });

    it('rejects over-long fields', function () {
        $this->postJson('/api/v1/auth/login', loginPayload([
            'email' => str_repeat('a', 250).'@x.com',
            'password' => str_repeat('p', 256),
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'email' => 'The email field must not be greater than 255 characters.',
                'password' => 'The password field must not be greater than 255 characters.',
            ]);
    });

    it('rejects non-string fields', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => ['x']]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['password' => 'The password field must be a string.']);
    });
});

describe('credential checks (401 / 403, first failure wins)', function () {
    it('rejects an unknown email with 401 and the exact body', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'nobody@pos.test']))
            ->assertUnauthorized()
            ->assertExactJson(['message' => LoginAction::MESSAGE_INVALID_CREDENTIALS]);
    });

    it('rejects a wrong password with 401 and the exact body', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid email or password.']);
    });

    it('returns the 401 as JSON even without an Accept header', function () {
        $this->post('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid email or password.']);
    });

    it('rejects a soft-deleted user as unknown (401)', function () {
        $this->cashier->delete();

        $this->postJson('/api/v1/auth/login', loginPayload())
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid email or password.']);
    });

    it('rejects a deactivated user whose password is correct with 403 and the exact body', function () {
        $this->cashier->update(['is_active' => false]);

        $this->postJson('/api/v1/auth/login', loginPayload())
            ->assertForbidden()
            ->assertExactJson(['message' => LoginAction::MESSAGE_DEACTIVATED]);
    });

    it('does not reveal deactivation when the password is wrong (401)', function () {
        $this->cashier->update(['is_active' => false]);

        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid email or password.']);
    });

    it('issues no token and writes no audit entry on failure', function () {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))->assertUnauthorized();

        $this->cashier->update(['is_active' => false]);
        $this->postJson('/api/v1/auth/login', loginPayload())->assertForbidden();

        expect(PersonalAccessToken::query()->count())->toBe(0)
            ->and(AuditLog::query()->count())->toBe(0)
            ->and($this->cashier->fresh()->last_login_at)->toBeNull();
    });
});

it('rate-limits to 5 attempts per minute per email + IP, counting failed 401 attempts', function () {
    foreach (range(1, 5) as $attempt) {
        $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid email or password.']);
    }

    $this->postJson('/api/v1/auth/login', loginPayload(['password' => 'wrong-password']))
        ->assertTooManyRequests()
        ->assertExactJson(['message' => 'Too Many Attempts.']);

    // Also with the correct password: still limited.
    $this->postJson('/api/v1/auth/login', loginPayload())->assertTooManyRequests();

    // The key includes the email (case-insensitive), so another email is not affected.
    $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'someone@pos.test']))->assertUnauthorized();
    $this->postJson('/api/v1/auth/login', loginPayload(['email' => 'CASHIER@pos.test']))->assertTooManyRequests();

    // After a minute the limit resets.
    $this->travel(61)->seconds();
    $this->postJson('/api/v1/auth/login', loginPayload())->assertOk();
});
