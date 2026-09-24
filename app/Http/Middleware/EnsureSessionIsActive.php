<?php

namespace App\Http\Middleware;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs after auth:sanctum. Rejects (and revokes) a token whose user or
 * device has been deactivated or soft-deleted since login, or that is not
 * bound to a device at all.
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

        // BelongsTo respects SoftDeletes, so a soft-deleted device resolves to null.
        $device = $token->device;

        if (! $user->is_active || $user->trashed() || $device === null || ! $device->is_active) {
            $token->delete();

            throw new AuthenticationException;
        }

        return $next($request);
    }
}
