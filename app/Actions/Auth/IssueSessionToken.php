<?php

namespace App\Actions\Auth;

use App\Models\User;
use Laravel\Sanctum\NewAccessToken;

/**
 * Starts an app session for a user, as login does: issues a new `mobile-app` token
 * (expiring after `pos.auth_token_ttl_hours`, not bound to a device), sets
 * `last_login_at` without bumping `updated_at`, and makes the new token the user's
 * current one with the relations `AuthUser` needs loaded.
 *
 * Shared by LoginAction and PinSwitchAction; run it inside the caller's transaction.
 * The user's other tokens are left alone.
 */
class IssueSessionToken
{
    public function execute(User $user): NewAccessToken
    {
        $now = now();

        $token = $user->createApiToken(
            $now->copy()->addHours((int) config('pos.auth_token_ttl_hours', 24)),
        );

        // A login is not a profile edit, so it must not bump users.updated_at (used for delta sync).
        User::withoutTimestamps(fn () => $user->forceFill(['last_login_at' => $now])->save());

        $user->withAccessToken($token->accessToken);
        $user->loadMissing(['role.permissions', 'branch']);

        return $token;
    }
}
