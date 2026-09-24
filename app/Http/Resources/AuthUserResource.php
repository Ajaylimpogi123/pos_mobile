<?php

namespace App\Http\Resources;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `AuthUser` object. `device` is the device the current
 * access token is bound to.
 *
 * @mixin User
 */
class AuthUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;

        $token = $user->currentAccessToken();
        $device = $token instanceof PersonalAccessToken ? $token->device : null;

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'is_active' => (bool) $user->is_active,
            'last_login_at' => $user->last_login_at?->toIso8601ZuluString(),
            'role' => [
                'id' => $user->role->id,
                'slug' => $user->role->slug,
                'name' => $user->role->name,
                'max_discount_percent' => (int) $user->role->max_discount_percent,
                'is_admin' => (bool) $user->role->is_admin,
            ],
            'branch' => [
                'id' => $user->branch->id,
                'code' => $user->branch->code,
                'name' => $user->branch->name,
                'timezone' => $user->branch->timezone,
                'day_start_time' => $user->branch->dayStartHourMinute(),
            ],
            'device' => $device === null ? null : [
                'id' => $device->id,
                'code' => $device->code,
                'name' => $device->name,
            ],
            'permissions' => $user->permissionSlugs(),
        ];
    }
}
