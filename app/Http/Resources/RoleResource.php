<?php

namespace App\Http\Resources;

use App\Models\Role;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A role in GET /api/v1/admin/roles. `assignable` is computed for the caller under
 * the role hierarchy; `permissions` are sorted A→Z.
 *
 * @mixin Role
 */
class RoleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $caller = $request->user();

        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'name' => $this->name,
            'is_admin' => (bool) $this->is_admin,
            'max_discount_percent' => (int) $this->max_discount_percent,
            'permissions' => $this->permissionSlugs(),
            'assignable' => $caller instanceof User && $this->resource->isGrantableBy($caller),
        ];
    }
}
