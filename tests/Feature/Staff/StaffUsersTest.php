<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Permission;
use App\Models\PersonalAccessToken;
use App\Models\Role;
use App\Models\User;
use App\Rules\Pin;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner', 'email' => 'owner@pos.test']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager', 'email' => 'manager@pos.test']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier', 'email' => 'cashier@pos.test']);

    $this->roleIds = Role::query()->pluck('id', 'slug');
    $this->managerToken = tokenFor($this->manager);
});

/**
 * A valid create body, with overrides.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function staffPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Nina New',
        'email' => 'nina@pos.test',
        'password' => STRONG_PASSWORD,
        'role_id' => Role::query()->where('slug', 'cashier')->value('id'),
    ], $overrides);
}

describe('store', function () {
    it('creates a staff user in the caller\'s branch and returns 201 with a StaffUser', function () {
        $response = $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['pin' => '2580']))
            ->assertCreated();

        $user = User::query()->where('email', 'nina@pos.test')->firstOrFail();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(staffUserKeys());

        $response->assertJsonPath('data', [
            'id' => $user->id,
            'name' => 'Nina New',
            'email' => 'nina@pos.test',
            'is_active' => true,
            'has_pin' => true,
            'can_manage' => true,
            'last_login_at' => null,
            'role' => ['id' => $this->roleIds['cashier'], 'slug' => 'cashier', 'name' => 'Cashier'],
            'created_at' => $user->created_at->toIso8601ZuluString(),
            'updated_at' => $user->updated_at->toIso8601ZuluString(),
        ]);

        expect($user->branch_id)->toBe($this->branch->id)
            ->and(Hash::check(STRONG_PASSWORD, $user->password))->toBeTrue()
            ->and(Hash::check('2580', $user->pin_hash))->toBeTrue()
            ->and($user->created_by)->toBe($this->manager->id)
            ->and($user->updated_by)->toBe($this->manager->id);
    });

    it('defaults is_active to true, has_pin to false, and accepts is_active false', function () {
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload())
            ->assertCreated()
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.has_pin', false);

        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['email' => 'off@pos.test', 'is_active' => false, 'pin' => null]))
            ->assertCreated()
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.has_pin', false);
    });

    it('ignores a branch_id in the body', function () {
        $other = Branch::factory()->create();

        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['branch_id' => $other->id]))
            ->assertCreated();

        expect(User::query()->where('email', 'nina@pos.test')->value('branch_id'))->toBe($this->branch->id);
    });

    it('stores the email lowercased and trimmed', function () {
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['email' => '  Nina.NEW@POS.Test ']))
            ->assertCreated()
            ->assertJsonPath('data.email', 'nina.new@pos.test');

        expect(User::query()->where('email', 'nina.new@pos.test')->exists())->toBeTrue();
    });

    it('writes user.created and user.pin_set audit entries without secrets', function () {
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['pin' => '2580']))
            ->assertCreated();

        $user = User::query()->where('email', 'nina@pos.test')->firstOrFail();
        $created = lastAudit('user.created');

        expect($created->actor_id)->toBe($this->manager->id)
            ->and($created->subject_id)->toBe($user->id)
            ->and(ksortDeep($created->changes))->toBe(ksortDeep([
                'name' => ['from' => null, 'to' => 'Nina New'],
                'email' => ['from' => null, 'to' => 'nina@pos.test'],
                'role_id' => ['from' => null, 'to' => $this->roleIds['cashier']],
                'is_active' => ['from' => null, 'to' => true],
                'branch_id' => ['from' => null, 'to' => $this->branch->id],
            ]));

        expect(lastAudit('user.pin_set'))->not->toBeNull()
            ->and(lastAudit('user.pin_set')->subject_id)->toBe($user->id)
            ->and(lastAudit('user.pin_set')->changes)->toBeNull();
    });

    it('lets a manager create a manager, and an owner create an owner', function () {
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['role_id' => $this->roleIds['manager']]))
            ->assertCreated()
            ->assertJsonPath('data.role.slug', 'manager');

        $this->withToken(tokenFor($this->owner))
            ->postJson('/api/v1/admin/users', staffPayload(['email' => 'owner2@pos.test', 'role_id' => $this->roleIds['owner']]))
            ->assertCreated()
            ->assertJsonPath('data.role.slug', 'owner');
    });

    it('rejects a manager assigning the owner role with 422', function () {
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['role_id' => $this->roleIds['owner']]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role_id' => 'You cannot assign this role.']);

        expect(User::query()->where('email', 'nina@pos.test')->exists())->toBeFalse();
    });

    it('forbids a cashier (403 before validation)', function () {
        $this->withToken(tokenFor($this->cashier))
            ->postJson('/api/v1/admin/users', [])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 401 without a token', function () {
        $this->postJson('/api/v1/admin/users', staffPayload())
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    describe('validation (422)', function () {
        it('requires name, email, password and role_id', function () {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', [])
                ->assertUnprocessable()
                ->assertJsonValidationErrors([
                    'name' => 'The name field is required.',
                    'email' => 'The email field is required.',
                    'password' => 'The password field is required.',
                    'role_id' => 'The role id field is required.',
                ]);
        });

        it('enforces max lengths and a valid email', function () {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload([
                    'name' => str_repeat('a', 101),
                    'email' => 'not-an-email',
                    'password' => STRONG_PASSWORD.str_repeat('a', 250),
                ]))
                ->assertUnprocessable()
                ->assertJsonValidationErrors([
                    'name' => 'The name field must not be greater than 100 characters.',
                    'email' => 'The email field must be a valid email address.',
                    'password' => 'The password field must not be greater than 255 characters.',
                ]);
        });

        it('enforces the password policy', function (string $password, string $message) {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['password' => $password]))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['password' => $message]);
        })->with([
            'too short' => ['Abcdef123', 'The password field must be at least 10 characters.'],
            'no uppercase' => ['abcdefgh123', 'The password field must contain at least one uppercase and one lowercase letter.'],
            'no lowercase' => ['ABCDEFGH123', 'The password field must contain at least one uppercase and one lowercase letter.'],
            'no number' => ['Abcdefghijk', 'The password field must contain at least one number.'],
        ]);

        it('rejects an unknown role and a non-integer role', function () {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['role_id' => 999999]))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['role_id' => 'The selected role id is invalid.']);

            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['role_id' => 'cashier']))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['role_id' => 'The role id field must be an integer.']);
        });

        it('rejects a non-boolean is_active', function () {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['is_active' => 'yes']))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['is_active' => 'The is active field must be true or false.']);
        });

        it('rejects a duplicate email case-insensitively', function () {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['email' => 'CASHIER@pos.test']))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['email' => 'The email has already been taken.']);
        });

        it('allows reusing the email of a soft-deleted user', function () {
            $this->cashier->delete();

            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['email' => 'cashier@pos.test']))
                ->assertCreated()
                ->assertJsonPath('data.email', 'cashier@pos.test');
        });

        it('validates the PIN on create', function () {
            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['pin' => '1234']))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['pin']);

            $this->withToken($this->managerToken)
                ->postJson('/api/v1/admin/users', staffPayload(['pin' => 2580]))
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['pin' => 'The pin field must be a string.']);
        });
    });
});

describe('show', function () {
    it('returns the StaffUser', function () {
        $response = $this->withToken($this->managerToken)
            ->getJson("/api/v1/admin/users/{$this->cashier->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $this->cashier->id)
            ->assertJsonPath('data.email', 'cashier@pos.test')
            ->assertJsonPath('data.has_pin', false)
            ->assertJsonPath('data.can_manage', true)
            ->assertJsonPath('data.role', ['id' => $this->roleIds['cashier'], 'slug' => 'cashier', 'name' => 'Cashier']);

        expect(array_keys($response->json('data')))->toBe(staffUserKeys());
    });

    it('shows the caller\'s own record with can_manage true', function () {
        $this->withToken($this->managerToken)
            ->getJson("/api/v1/admin/users/{$this->manager->id}")
            ->assertOk()
            ->assertJsonPath('data.can_manage', true);
    });

    it('returns 404 for an unknown, soft-deleted, or other-branch user', function () {
        $deleted = userWithRole('cashier');
        $deleted->delete();
        $outsider = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();

        foreach ([999999, $deleted->id, $outsider->id] as $id) {
            $this->withToken($this->managerToken)
                ->getJson("/api/v1/admin/users/{$id}")
                ->assertNotFound()
                ->assertExactJson(['message' => 'Resource not found.']);
        }
    });

    it('forbids a cashier and returns 401 without a token', function () {
        $this->withToken(tokenFor($this->cashier))
            ->getJson("/api/v1/admin/users/{$this->cashier->id}")
            ->assertForbidden();

        $this->withoutToken()->getJson("/api/v1/admin/users/{$this->cashier->id}")->assertUnauthorized();
    });
});

describe('update', function () {
    it('applies a partial update and returns the StaffUser', function () {
        $response = $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['name' => 'Carla C.'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Carla C.')
            ->assertJsonPath('data.email', 'cashier@pos.test')
            ->assertJsonPath('data.is_active', true);

        expect(array_keys($response->json('data')))->toBe(staffUserKeys())
            ->and($this->cashier->fresh()->updated_by)->toBe($this->manager->id);
    });

    it('changes the role and reports it', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['role_id' => $this->roleIds['manager']])
            ->assertOk()
            ->assertJsonPath('data.role', ['id' => $this->roleIds['manager'], 'slug' => 'manager', 'name' => 'Manager']);

        expect(ksortDeep(lastAudit('user.updated')->changes))->toBe(ksortDeep([
            'role_id' => ['from' => $this->roleIds['cashier'], 'to' => $this->roleIds['manager']],
        ]));
    });

    it('stores an updated email lowercased and trimmed, and keeps it unique', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['email' => ' Carla@POS.test '])
            ->assertOk()
            ->assertJsonPath('data.email', 'carla@pos.test');

        // Its own current email (in any case) is not a conflict.
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['email' => 'CARLA@pos.test'])
            ->assertOk();

        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['email' => 'Manager@POS.test'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email' => 'The email has already been taken.']);
    });

    it('ignores password and pin in the body', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", [
                'name' => 'Carla C.',
                'password' => 'An0therPassword',
                'pin' => '2580',
            ])
            ->assertOk()
            ->assertJsonPath('data.has_pin', false);

        $fresh = $this->cashier->fresh();

        expect(Hash::check('password', $fresh->password))->toBeTrue()
            ->and($fresh->pin_hash)->toBeNull()
            ->and(ksortDeep(lastAudit('user.updated')->changes))->toBe(ksortDeep(['name' => ['from' => 'Carla Cashier', 'to' => 'Carla C.']]))
            ->and(lastAudit('user.password_reset'))->toBeNull()
            ->and(lastAudit('user.pin_set'))->toBeNull();
    });

    it('writes nothing when nothing changes', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['name' => 'Carla Cashier', 'password' => 'An0therPassword'])
            ->assertOk();

        expect(lastAudit('user.updated'))->toBeNull();
    });

    it('deactivates a user and revokes all of their tokens at once', function () {
        $tokenA = tokenFor($this->cashier);
        $tokenB = tokenFor($this->cashier);

        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        expect($this->cashier->tokens()->count())->toBe(0)
            ->and(ksortDeep(lastAudit('user.updated')->changes))->toBe(ksortDeep(['is_active' => ['from' => true, 'to' => false]]));

        $this->withToken($tokenA)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->withToken($tokenB)->getJson('/api/v1/auth/me')->assertUnauthorized();

        // The caller's own session is untouched.
        $this->withToken($this->managerToken)->getJson('/api/v1/auth/me')->assertOk();
    });

    it('reactivates a user', function () {
        $inactive = userWithRole('cashier', ['is_active' => false]);

        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$inactive->id}", ['is_active' => true])
            ->assertOk()
            ->assertJsonPath('data.is_active', true);
    });

    it('rejects a manager assigning the owner role with 422', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['role_id' => $this->roleIds['owner']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role_id' => 'You cannot assign this role.']);

        expect($this->cashier->fresh()->role_id)->toBe($this->roleIds['cashier']);
    });

    it('rejects null or invalid values', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", [
                'name' => null, 'email' => 'nope', 'role_id' => null, 'is_active' => null,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'name' => 'The name field is required.',
                'email' => 'The email field must be a valid email address.',
                'role_id' => 'The role id field is required.',
                'is_active' => 'The is active field is required.',
            ]);
    });

    it('returns 404 for another branch\'s user and 403 for a cashier', function () {
        $outsider = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();

        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$outsider->id}", ['name' => 'X'])
            ->assertNotFound();

        $this->withToken(tokenFor($this->cashier))
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['name' => 'X'])
            ->assertForbidden();

        $this->withoutToken()->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['name' => 'X'])->assertUnauthorized();
    });
});

describe('self-protection (409)', function () {
    it('forbids changing your own role', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->manager->id}", ['role_id' => $this->roleIds['cashier']])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'You cannot change your own role.']);

        $this->withToken(tokenFor($this->owner))
            ->patchJson("/api/v1/admin/users/{$this->owner->id}", ['role_id' => $this->roleIds['manager']])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'You cannot change your own role.']);

        expect($this->manager->fresh()->role_id)->toBe($this->roleIds['manager'])
            ->and($this->owner->fresh()->role_id)->toBe($this->roleIds['owner']);
    });

    it('treats sending your current role_id unchanged as no role change', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->manager->id}", [
                'name' => 'Marco M.',
                'role_id' => $this->roleIds['manager'],
                'is_active' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Marco M.')
            ->assertJsonPath('data.role.slug', 'manager');
    });

    it('forbids deactivating yourself', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->manager->id}", ['is_active' => false])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'You cannot deactivate your own account.']);

        expect($this->manager->fresh()->is_active)->toBeTrue();
        $this->withToken($this->managerToken)->getJson('/api/v1/auth/me')->assertOk();
    });

    it('forbids deleting yourself', function () {
        $this->withToken($this->managerToken)
            ->deleteJson("/api/v1/admin/users/{$this->manager->id}")
            ->assertStatus(409)
            ->assertExactJson(['message' => 'You cannot delete your own account.']);

        expect($this->manager->fresh()->trashed())->toBeFalse();
    });
});

describe('destroy', function () {
    it('soft-deletes the user, revokes their tokens, and audits it', function () {
        $cashierToken = tokenFor($this->cashier);

        $this->withToken($this->managerToken)
            ->deleteJson("/api/v1/admin/users/{$this->cashier->id}")
            ->assertNoContent();

        expect(User::withTrashed()->find($this->cashier->id)->trashed())->toBeTrue()
            ->and(PersonalAccessToken::query()->where('tokenable_id', $this->cashier->id)->count())->toBe(0)
            ->and(lastAudit('user.deleted')->changes)->toBe(['name' => 'Carla Cashier', 'email' => 'cashier@pos.test'])
            ->and(lastAudit('user.deleted')->actor_id)->toBe($this->manager->id);

        $this->withToken($cashierToken)->getJson('/api/v1/auth/me')->assertUnauthorized();

        $this->withToken($this->managerToken)
            ->getJson("/api/v1/admin/users/{$this->cashier->id}")
            ->assertNotFound();

        $this->withToken($this->managerToken)
            ->deleteJson("/api/v1/admin/users/{$this->cashier->id}")
            ->assertNotFound();
    });

    it('returns 404 for another branch\'s user, 403 for a cashier, 401 without a token', function () {
        $outsider = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();

        $this->withToken($this->managerToken)->deleteJson("/api/v1/admin/users/{$outsider->id}")->assertNotFound();
        $this->withToken(tokenFor($this->cashier))->deleteJson("/api/v1/admin/users/{$this->manager->id}")->assertForbidden();
        $this->withoutToken()->deleteJson("/api/v1/admin/users/{$this->cashier->id}")->assertUnauthorized();
    });
});

describe('reset password', function () {
    it('sets the new password, revokes all of the target\'s tokens, and audits without the value', function () {
        $cashierToken = tokenFor($this->cashier);

        $this->withToken($this->managerToken)
            ->postJson("/api/v1/admin/users/{$this->cashier->id}/password", ['password' => STRONG_PASSWORD])
            ->assertNoContent();

        expect(Hash::check(STRONG_PASSWORD, $this->cashier->fresh()->password))->toBeTrue()
            ->and($this->cashier->tokens()->count())->toBe(0);

        $this->withToken($cashierToken)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->withToken($this->managerToken)->getJson('/api/v1/auth/me')->assertOk();

        $audit = lastAudit('user.password_reset');
        expect($audit->subject_id)->toBe($this->cashier->id)
            ->and($audit->changes)->toBe(['revoked_tokens' => 1])
            ->and(json_encode($audit->changes))->not->toContain(STRONG_PASSWORD);

        // The new password logs in.
        $this->postJson('/api/v1/auth/login', ['email' => 'cashier@pos.test', 'password' => STRONG_PASSWORD])->assertOk();
    });

    it('keeps the caller\'s current token when resetting their own password, revoking the others', function () {
        $otherToken = tokenFor($this->manager);

        $this->withToken($this->managerToken)
            ->postJson("/api/v1/admin/users/{$this->manager->id}/password", ['password' => STRONG_PASSWORD])
            ->assertNoContent();

        $this->withToken($this->managerToken)->getJson('/api/v1/auth/me')->assertOk();
        $this->withToken($otherToken)->getJson('/api/v1/auth/me')->assertUnauthorized();

        expect($this->manager->tokens()->count())->toBe(1);
    });

    it('validates the password policy', function () {
        $this->withToken($this->managerToken)
            ->postJson("/api/v1/admin/users/{$this->cashier->id}/password", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['password' => 'The password field is required.']);

        $this->withToken($this->managerToken)
            ->postJson("/api/v1/admin/users/{$this->cashier->id}/password", ['password' => 'short1A'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['password' => 'The password field must be at least 10 characters.']);

        expect(Hash::check('password', $this->cashier->fresh()->password))->toBeTrue();
    });

    it('returns 404 for another branch\'s user, 403 for a cashier, 401 without a token', function () {
        $outsider = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();
        $body = ['password' => STRONG_PASSWORD];

        $this->withToken($this->managerToken)->postJson("/api/v1/admin/users/{$outsider->id}/password", $body)->assertNotFound();
        $this->withToken(tokenFor($this->cashier))->postJson("/api/v1/admin/users/{$this->cashier->id}/password", $body)->assertForbidden();
        $this->withoutToken()->postJson("/api/v1/admin/users/{$this->cashier->id}/password", $body)->assertUnauthorized();
    });
});

describe('pin', function () {
    it('sets a PIN (hashed) and returns the StaffUser with has_pin true', function () {
        $response = $this->withToken($this->managerToken)
            ->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => '0580'])
            ->assertOk()
            ->assertJsonPath('data.id', $this->cashier->id)
            ->assertJsonPath('data.has_pin', true);

        $fresh = $this->cashier->fresh();

        expect(array_keys($response->json('data')))->toBe(staffUserKeys())
            ->and($fresh->pin_hash)->not->toBe('0580')
            ->and(Hash::check('0580', $fresh->pin_hash))->toBeTrue()
            ->and(lastAudit('user.pin_set')->subject_id)->toBe($this->cashier->id)
            ->and(lastAudit('user.pin_set')->changes)->toBeNull();
    });

    it('removes the PIN with null', function () {
        $this->cashier->forceFill(['pin_hash' => Hash::make('1357')])->save();

        $this->withToken($this->managerToken)
            ->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => null])
            ->assertOk()
            ->assertJsonPath('data.has_pin', false);

        expect($this->cashier->fresh()->pin_hash)->toBeNull()
            ->and(lastAudit('user.pin_removed')->subject_id)->toBe($this->cashier->id);
    });

    it('does nothing when removing a PIN that is not set', function () {
        $this->withToken($this->managerToken)
            ->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => null])
            ->assertOk()
            ->assertJsonPath('data.has_pin', false);

        expect(lastAudit('user.pin_removed'))->toBeNull();
    });

    it('accepts valid PINs', function (string $pin) {
        $this->withToken($this->managerToken)
            ->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => $pin])
            ->assertOk()
            ->assertJsonPath('data.has_pin', true);
    })->with(['1357', '2580', '0007', '7890', '13579', '102938', '1123']);

    it('rejects invalid or trivial PINs', function (mixed $pin, string $message) {
        $this->withToken($this->managerToken)
            ->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => $pin])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['pin' => $message]);

        expect($this->cashier->fresh()->pin_hash)->toBeNull();
    })->with([
        'integer' => [1357, 'The pin field must be a string.'],
        'too short' => ['135', 'The pin must be 4 to 6 digits.'],
        'too long' => ['1357913', 'The pin must be 4 to 6 digits.'],
        'letters' => ['13a7', 'The pin must be 4 to 6 digits.'],
        'spaces' => ['13 57', 'The pin must be 4 to 6 digits.'],
        'decimal' => ['13.5', 'The pin must be 4 to 6 digits.'],
        'negative' => ['-1357', 'The pin must be 4 to 6 digits.'],
        'all same' => ['1111', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
        'all zeros (6)' => ['000000', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
        'ascending' => ['1234', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
        'ascending from 0' => ['0123', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
        'descending' => ['4321', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
        'ascending (6)' => ['123456', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
        'descending (6)' => ['987654', 'The pin is too easy to guess. Avoid repeated digits and straight sequences.'],
    ]);

    it('rejects a trailing newline at the rule level (the API trims input before validation)', function () {
        expect(Validator::make(['pin' => "2580\n"], ['pin' => ['string', new Pin]])->fails())->toBeTrue()
            ->and(Validator::make(['pin' => '2580'], ['pin' => ['string', new Pin]])->passes())->toBeTrue();
    });

    it('requires the pin key', function () {
        $this->withToken($this->managerToken)
            ->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['pin' => 'The pin field must be present.']);
    });

    it('returns 404 for another branch\'s user, 403 for a cashier, 401 without a token', function () {
        $outsider = User::factory()->forBranch(Branch::factory()->create())->withRole('cashier')->create();

        $this->withToken($this->managerToken)->putJson("/api/v1/admin/users/{$outsider->id}/pin", ['pin' => '2580'])->assertNotFound();
        $this->withToken(tokenFor($this->cashier))->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => '2580'])->assertForbidden();
        $this->withoutToken()->putJson("/api/v1/admin/users/{$this->cashier->id}/pin", ['pin' => '2580'])->assertUnauthorized();
    });
});

describe('role hierarchy', function () {
    it('forbids a manager from acting on an owner (403 on every endpoint)', function () {
        $id = $this->owner->id;
        $token = $this->managerToken;

        $this->withToken($token)->getJson("/api/v1/admin/users/{$id}")
            ->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        $this->withToken($token)->patchJson("/api/v1/admin/users/{$id}", ['name' => 'Hacked'])->assertForbidden();
        $this->withToken($token)->patchJson("/api/v1/admin/users/{$id}", ['is_active' => false])->assertForbidden();
        $this->withToken($token)->deleteJson("/api/v1/admin/users/{$id}")->assertForbidden();
        $this->withToken($token)->postJson("/api/v1/admin/users/{$id}/password", ['password' => STRONG_PASSWORD])->assertForbidden();
        $this->withToken($token)->putJson("/api/v1/admin/users/{$id}/pin", ['pin' => '2580'])->assertForbidden();

        $owner = $this->owner->fresh();
        expect($owner->name)->toBe('Olivia Owner')
            ->and($owner->is_active)->toBeTrue()
            ->and($owner->trashed())->toBeFalse()
            ->and(Hash::check('password', $owner->password))->toBeTrue()
            ->and($owner->pin_hash)->toBeNull();
    });

    it('checks the hierarchy before validation (403, not 422)', function () {
        $this->withToken($this->managerToken)
            ->patchJson("/api/v1/admin/users/{$this->owner->id}", ['email' => 'not-an-email'])
            ->assertForbidden();
    });

    it('lets a manager manage another manager and a cashier', function () {
        $manager2 = userWithRole('manager', ['email' => 'manager2@pos.test']);

        foreach ([$manager2, $this->cashier] as $target) {
            $this->withToken($this->managerToken)->getJson("/api/v1/admin/users/{$target->id}")
                ->assertOk()->assertJsonPath('data.can_manage', true);
            $this->withToken($this->managerToken)->patchJson("/api/v1/admin/users/{$target->id}", ['name' => 'Renamed'])
                ->assertOk();
            $this->withToken($this->managerToken)->putJson("/api/v1/admin/users/{$target->id}/pin", ['pin' => '2580'])
                ->assertOk();
            $this->withToken($this->managerToken)->postJson("/api/v1/admin/users/{$target->id}/password", ['password' => STRONG_PASSWORD])
                ->assertNoContent();
            $this->withToken($this->managerToken)->deleteJson("/api/v1/admin/users/{$target->id}")
                ->assertNoContent();
        }
    });

    it('lets an owner manage everyone, including another owner', function () {
        $owner2 = userWithRole('owner', ['email' => 'owner2@pos.test']);
        $ownerToken = tokenFor($this->owner);

        foreach ([$owner2, $this->manager, $this->cashier] as $target) {
            $this->withToken($ownerToken)->getJson("/api/v1/admin/users/{$target->id}")
                ->assertOk()->assertJsonPath('data.can_manage', true);
            $this->withToken($ownerToken)->patchJson("/api/v1/admin/users/{$target->id}", ['name' => 'Renamed'])
                ->assertOk();
            $this->withToken($ownerToken)->putJson("/api/v1/admin/users/{$target->id}/pin", ['pin' => '2580'])
                ->assertOk();
            $this->withToken($ownerToken)->postJson("/api/v1/admin/users/{$target->id}/password", ['password' => STRONG_PASSWORD])
                ->assertNoContent();
        }

        $this->withToken($ownerToken)
            ->patchJson("/api/v1/admin/users/{$this->cashier->id}", ['role_id' => $this->roleIds['owner']])
            ->assertOk()
            ->assertJsonPath('data.role.slug', 'owner');

        $this->withToken($ownerToken)->deleteJson("/api/v1/admin/users/{$owner2->id}")->assertNoContent();
    });

    it('compares permission sets, not role names (a custom role above yours is off limits)', function () {
        $custom = Role::factory()->create(['slug' => 'auditor', 'name' => 'Auditor']);
        $custom->permissions()->sync(Permission::query()->whereIn('slug', ['report.view', 'branch.all'])->pluck('id'));
        $auditor = userWithRole('auditor');

        $this->withToken($this->managerToken)->getJson("/api/v1/admin/users/{$auditor->id}")->assertForbidden();
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['role_id' => $custom->id]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role_id' => 'You cannot assign this role.']);

        // A role with a subset of the caller's permissions is fine; a role with none too.
        $empty = Role::factory()->create();
        $this->withToken($this->managerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['role_id' => $empty->id]))
            ->assertCreated();
    });
});

describe('audit', function () {
    it('never writes a password, PIN or PIN hash to any user audit entry', function () {
        $ownerToken = tokenFor($this->owner);

        $this->withToken($ownerToken)
            ->postJson('/api/v1/admin/users', staffPayload(['pin' => '2580']))
            ->assertCreated();
        $id = User::query()->where('email', 'nina@pos.test')->value('id');

        $this->withToken($ownerToken)->patchJson("/api/v1/admin/users/{$id}", [
            'name' => 'Nina N.', 'email' => 'nina.n@pos.test', 'role_id' => $this->roleIds['manager'],
            'is_active' => false, 'password' => 'Upd4tedPassword', 'pin' => '9630',
        ])->assertOk();
        $this->withToken($ownerToken)->putJson("/api/v1/admin/users/{$id}/pin", ['pin' => '1470'])->assertOk();
        $this->withToken($ownerToken)->putJson("/api/v1/admin/users/{$id}/pin", ['pin' => null])->assertOk();
        $this->withToken($ownerToken)->postJson("/api/v1/admin/users/{$id}/password", ['password' => 'Res3tPassword'])->assertNoContent();
        $this->withToken($ownerToken)->deleteJson("/api/v1/admin/users/{$id}")->assertNoContent();

        $entries = AuditLog::query()->where('action', 'like', 'user.%')->orderBy('id')->get();

        expect($entries->pluck('action')->all())->toBe([
            'user.created', 'user.pin_set', 'user.updated', 'user.pin_set', 'user.pin_removed',
            'user.password_reset', 'user.deleted',
        ]);

        foreach ($entries as $entry) {
            $changes = $entry->changes ?? [];
            $json = json_encode($changes);

            expect(array_keys($changes))->not->toContain('password')
                ->and(array_keys($changes))->not->toContain('pin')
                ->and(array_keys($changes))->not->toContain('pin_hash');

            foreach ([STRONG_PASSWORD, 'Upd4tedPassword', 'Res3tPassword', '2580', '9630', '1470', '$2y$', 'pin_hash'] as $secret) {
                expect($json)->not->toContain($secret);
            }
        }

        expect(ksortDeep(AuditLog::query()->where('action', 'user.updated')->first()->changes))->toBe(ksortDeep([
            'name' => ['from' => 'Nina New', 'to' => 'Nina N.'],
            'email' => ['from' => 'nina@pos.test', 'to' => 'nina.n@pos.test'],
            'role_id' => ['from' => $this->roleIds['cashier'], 'to' => $this->roleIds['manager']],
            'is_active' => ['from' => true, 'to' => false],
        ]));
    });
});
