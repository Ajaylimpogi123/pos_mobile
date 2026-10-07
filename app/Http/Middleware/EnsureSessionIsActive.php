<?php

namespace App\Http\Middleware;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs after auth:sanctum. Rejects (and revokes) a token whose user has
 * been deactivated or soft-deleted since login. Tokens are not bound to a
 * device, so no device state is checked.
 */
class EnsureSessionIsActive
{
    /**
     * @param  Closure(Request): (Response)  $next
     *
     * @throws AuthenticationException
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $user instanceof User ? $user->currentAccessToken() : null;

        if (! $token instanceof PersonalAccessToken) {
            throw new AuthenticationException;
        }

        if (! $user->is_active || $user->trashed()) {
            $token->delete();

            throw new AuthenticationException;
        }

        return $next($request);
    }
}
