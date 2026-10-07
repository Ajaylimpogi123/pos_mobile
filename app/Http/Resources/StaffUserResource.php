<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `StaffUser` object (every staff endpoint, including the list).
 *
 * `can_manage` is computed for the caller under the role hierarchy; load
 * `role.permissions` on lists to avoid a query per row. The PIN and password are
 * never returned, only `has_pin`.
 *
 * @mixin User
 */
class StaffUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $caller = $request->user();

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'is_active' => (bool) $this->is_active,
            'has_pin' => $this->hasPin(),
            'can_manage' => $caller instanceof User && $caller->canManage($this->resource),
            'last_login_at' => $this->last_login_at?->toIso8601ZuluString(),
            'role' => [
                'id' => $this->role->id,
                'slug' => $this->role->slug,
                'name' => $this->role->name,
            ],
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
