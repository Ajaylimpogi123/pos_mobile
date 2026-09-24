<?php

namespace App\Actions\Auth;

use App\Models\User;
use Laravel\Sanctum\NewAccessToken;

/**
 * The outcome of a successful login: the user (with the new token set as
 * the current access token) and the newly issued token.
 */
final readonly class LoginResult
{
    public function __construct(
        public User $user,
        public NewAccessToken $token,
    ) {}
}
