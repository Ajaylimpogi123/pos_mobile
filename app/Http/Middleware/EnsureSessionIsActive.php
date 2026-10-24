<?php

namespace App\Http\Middleware;

use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs after auth:sanctum. Rejects (and revokes) a token whose user has been deactivated or
 * soft-deleted since login. Since Hardening & Pilot → C, a token bound to a retired device
 * gets `401 { "message": "This tablet has been retired." }` on every request (retiring
 * deletes the device's tokens, so this covers a token bound while the retire ran).
 */
class EnsureSessionIsActive
{
    public const MESSAGE_RETIRED = 'This tablet has been retired.';

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

        if ($token->device_id !== null && Device::withTrashed()->whereKey($token->device_id)->where('is_active', false)->exists()) {
            throw new AuthenticationException(self::MESSAGE_RETIRED);
        }

        return $next($request);
    }
}
