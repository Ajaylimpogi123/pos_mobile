<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\PersonalAccessToken;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-25 04:00:00');

    $this->cashier = withPin(userWithRole('cashier', ['name' => 'Carla Cashier', 'email' => 'cashier@pos.test']), '1357');
    $this->manager = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');
});

afterEach(function () {
    Carbon::setTestNow();
});

function pinSwitch(string $token, array $body): TestResponse
{
    return test()->withToken($token)->postJson('/api/v1/auth/pin', $body);
}

describe('GET /auth/pin-users', function () {
    it('lists active users of the caller\'s branch with a PIN, the caller included, by name', function () {
        $owner = withPin(userWithRole('owner', ['name' => 'Olivia Owner']), '1470');
        $ana = withPin(userWithRole('cashier', ['name' => 'Ana Cashier']), '9731');
        $zed = withPin(userWithRole('cashier', ['name' => 'Ana Cashier']), '9732'); // same name: id breaks the tie
        userWithRole('cashier', ['name' => 'No Pin']);
        withPin(userWithRole('cashier', ['name' => 'Inactive', 'is_active' => false]), '1111');
        withPin(userWithRole('cashier', ['name' => 'Deleted']), '2222')->delete();
        withPin(User::factory()->forBranch(Branch::factory()->create())->withRole('manager')->create(['name' => 'Elsewhere']), '3333');

        $response = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/auth/pin-users')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and($response->json('meta.per_page'))->toBe(100)
            ->and($response->json('meta.next_cursor'))->toBeNull()
            ->and($response->json('data'))->toBe([
                ['id' => $ana->id, 'name' => 'Ana Cashier', 'role' => ['slug' => 'cashier', 'name' => 'Cashier'], 'can_approve_discounts' => false, 'max_discount_percent' => 10, 'can_approve_voids' => false, 'can_approve_refunds' => false],
                ['id' => $zed->id, 'name' => 'Ana Cashier', 'role' => ['slug' => 'cashier', 'name' => 'Cashier'], 'can_approve_discounts' => false, 'max_discount_percent' => 10, 'can_approve_voids' => false, 'can_approve_refunds' => false],
                ['id' => $this->cashier->id, 'name' => 'Carla Cashier', 'role' => ['slug' => 'cashier', 'name' => 'Cashier'], 'can_approve_discounts' => false, 'max_discount_percent' => 10, 'can_approve_voids' => false, 'can_approve_refunds' => false],
                ['id' => $this->manager->id, 'name' => 'Marco Manager', 'role' => ['slug' => 'manager', 'name' => 'Manager'], 'can_approve_discounts' => true, 'max_discount_percent' => 100, 'can_approve_voids' => true, 'can_approve_refunds' => true],
                ['id' => $owner->id, 'name' => 'Olivia Owner', 'role' => ['slug' => 'owner', 'name' => 'Owner'], 'can_approve_discounts' => true, 'max_discount_percent' => 100, 'can_approve_voids' => true, 'can_approve_refunds' => true],
            ]);
    });

    it('excludes the caller without a PIN and paginates', function () {
        $noPin = userWithRole('manager', ['name' => 'Aaron Admin']);

        $page1 = $this->withToken(tokenFor($noPin))->getJson('/api/v1/auth/pin-users?per_page=1')->assertOk();
        expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$this->cashier->id])
            ->and($page1->json('meta.next_cursor'))->not->toBeNull();

        $page2 = $this->withToken(tokenFor($noPin))->getJson('/api/v1/auth/pin-users?per_page=1&cursor='.$page1->json('meta.next_cursor'))->assertOk();
        expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$this->manager->id]);
    });

    it('returns 401 without a token and 422 for a bad page size', function () {
        $this->getJson('/api/v1/auth/pin-users')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);

        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/auth/pin-users?per_page=101')
            ->assertUnprocessable()->assertJsonValidationErrorFor('per_page');
    });
});

describe('POST /auth/pin', function () {
    it('switches the session to the target: the login response, a new token, the old one revoked', function () {
        $oldToken = tokenFor($this->cashier);
        $updatedAt = $this->manager->fresh()->updated_at;
        $this->travel(5)->minutes();

        $response = pinSwitch($oldToken, ['user_id' => $this->manager->id, 'pin' => '2468'])->assertOk();

        expect(array_keys($response->json('data')))->toBe(['token', 'token_type', 'expires_at', 'user'])
            ->and(array_keys($response->json('data.user')))->toBe(['id', 'name', 'email', 'is_active', 'last_login_at', 'role', 'branch', 'permissions']);

        $response->assertJsonPath('data.token_type', 'Bearer')
            ->assertJsonPath('data.expires_at', now()->addHours(24)->toIso8601ZuluString())
            ->assertJsonPath('data.user.id', $this->manager->id)
            ->assertJsonPath('data.user.name', 'Marco Manager')
            ->assertJsonPath('data.user.role.slug', 'manager')
            ->assertJsonPath('data.user.last_login_at', now()->toIso8601ZuluString())
            ->assertJsonPath('data.user.branch.code', 'MAIN');

        $newToken = $response->json('data.token');

        // The new token works as the target; the old one is revoked.
        $this->app['auth']->forgetGuards();
        $this->withToken($newToken)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $this->manager->id);
        $this->app['auth']->forgetGuards();
        $this->withToken($oldToken)->getJson('/api/v1/auth/me')->assertUnauthorized();

        $token = PersonalAccessToken::query()->where('tokenable_id', $this->manager->id)->sole();
        expect($token->name)->toBe('mobile-app')
            ->and($token->expires_at->equalTo(now()->addHours(24)))->toBeTrue()
            ->and(PersonalAccessToken::query()->where('tokenable_id', $this->cashier->id)->count())->toBe(0);

        // last_login_at is set without bumping updated_at, like login.
        $fresh = $this->manager->fresh();
        expect($fresh->last_login_at->equalTo(now()))->toBeTrue()
            ->and($fresh->updated_at->equalTo($updatedAt))->toBeTrue();

        $audit = AuditLog::query()->where('action', 'auth.pin_switch')->sole();
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($this->manager->id)
            ->and($audit->changes)->toBe(['from_user_id' => $this->cashier->id])
            ->and(str_contains(json_encode($audit->changes), '2468'))->toBeFalse();
    });

    it('lets you switch to yourself, which renews the token', function () {
        $oldToken = tokenFor($this->cashier);

        $newToken = pinSwitch($oldToken, ['user_id' => $this->cashier->id, 'pin' => '1357'])
            ->assertOk()
            ->assertJsonPath('data.user.id', $this->cashier->id)
            ->json('data.token');

        expect($newToken)->not->toBe($oldToken)
            ->and(PersonalAccessToken::query()->where('tokenable_id', $this->cashier->id)->count())->toBe(1);

        $this->app['auth']->forgetGuards();
        $this->withToken($oldToken)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('only checks the PIN\'s shape on entry, not the strength rules', function () {
        $easy = withPin(userWithRole('cashier'), '1111');

        pinSwitch(tokenFor($this->cashier), ['user_id' => $easy->id, 'pin' => '1111'])->assertOk();
    });

    it('validates the fields', function (array $body, string $field) {
        pinSwitch(tokenFor($this->cashier), $body)->assertUnprocessable()->assertJsonValidationErrorFor($field);
    })->with([
        'no user' => [['pin' => '2468'], 'user_id'],
        'user not an integer' => [['user_id' => 'abc', 'pin' => '2468'], 'user_id'],
        'no pin' => [['user_id' => 1], 'pin'],
        'pin as a number' => [['user_id' => 1, 'pin' => 2468], 'pin'],
        'pin too short' => [['user_id' => 1, 'pin' => '246'], 'pin'],
        'pin too long' => [['user_id' => 1, 'pin' => '2468024'], 'pin'],
        'pin not digits' => [['user_id' => 1, 'pin' => '24a8'], 'pin'],
    ]);

    it('rejects a target who cannot sign in with a PIN', function (Closure $target) {
        $user = $target();

        pinSwitch(tokenFor($this->cashier), ['user_id' => $user?->id ?? 999999, 'pin' => '2468'])
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => "This person can't sign in with a PIN.",
                'errors' => ['user_id' => ["This person can't sign in with a PIN."]],
            ]);
    })->with([
        'unknown' => fn () => null,
        'deleted' => fn () => tap(withPin(userWithRole('manager'), '2468'))->delete(),
        'inactive' => fn () => withPin(userWithRole('manager', ['is_active' => false]), '2468'),
        'in another branch' => fn () => withPin(User::factory()->forBranch(Branch::factory()->create())->withRole('manager')->create(), '2468'),
        'without a PIN' => fn () => userWithRole('manager'),
    ]);

    it('rejects a wrong PIN, keeping the session', function () {
        $token = tokenFor($this->cashier);

        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '8642'])
            ->assertUnprocessable()
            ->assertExactJson(['message' => 'Incorrect PIN.', 'errors' => ['pin' => ['Incorrect PIN.']]]);

        expect(PersonalAccessToken::query()->where('tokenable_id', $this->manager->id)->count())->toBe(0)
            ->and(AuditLog::query()->where('action', 'auth.pin_switch')->count())->toBe(0);

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $this->cashier->id);
    });

    it('locks the target\'s PIN after 5 wrong PINs within 15 minutes', function () {
        $token = tokenFor($this->cashier);

        foreach (range(1, 5) as $attempt) {
            pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '0000'])->assertUnprocessable();
        }

        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])
            ->assertTooManyRequests()
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 15 minutes.']);

        // The lock is per PIN owner: another person is unaffected.
        pinSwitch($token, ['user_id' => $this->cashier->id, 'pin' => '1357'])->assertOk();

        $token = tokenFor($this->cashier);
        $this->travel(630)->seconds();
        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])
            ->assertTooManyRequests()
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 5 minutes.']);

        $this->travel(5)->minutes();
        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])->assertOk();
    });

    it('checks the target before the lock', function () {
        $token = tokenFor($this->cashier);
        foreach (range(1, 5) as $attempt) {
            pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '0000'])->assertUnprocessable();
        }

        $this->manager->update(['is_active' => false]);

        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['user_id' => "This person can't sign in with a PIN."]);
    });

    it('resets the counter on a correct PIN', function () {
        $token = tokenFor($this->cashier);

        foreach (range(1, 4) as $attempt) {
            pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '0000'])->assertUnprocessable();
        }

        $token = pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])->assertOk()->json('data.token');

        foreach (range(1, 4) as $attempt) {
            pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '0000'])->assertUnprocessable();
        }

        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])->assertOk();
    });

    it('shares the lock with discount approval', function () {
        $icedTea = Product::factory()->forCategory(Category::factory()->create())->create(['price_cents' => 3500]);
        $sale = fn (string $pin) => simpleSale([[$icedTea, 2]], [
            'discount' => ['type' => 'manual', 'kind' => 'percent', 'value' => 5000],
            'client_total_cents' => 3500,
            'payments' => [['method' => 'cash', 'amount_cents' => 3500, 'reference_no' => null]],
            'discount_authorization' => ['user_id' => $this->manager->id, 'pin' => $pin],
        ]);

        // 3 wrong at the checkout, 2 wrong at the switch screen: the manager's PIN is locked for both.
        foreach (range(1, 3) as $attempt) {
            postOrder($this->cashier, $sale('0000'))->assertUnprocessable()->assertJsonValidationErrors(['discount_authorization.pin' => 'Incorrect PIN.']);
        }
        $token = tokenFor($this->cashier);
        foreach (range(1, 2) as $attempt) {
            pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '0000'])->assertUnprocessable();
        }

        pinSwitch($token, ['user_id' => $this->manager->id, 'pin' => '2468'])->assertTooManyRequests();
        postOrder($this->cashier, $sale('2468'))->assertTooManyRequests()
            ->assertExactJson(['message' => 'Too many incorrect PIN attempts. Try again in 15 minutes.']);
    });

    it('returns 401 without a token', function () {
        $this->postJson('/api/v1/auth/pin', ['user_id' => $this->manager->id, 'pin' => '2468'])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});
