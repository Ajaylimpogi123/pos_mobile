<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET /api/v1/auth/pin-users: someone who can PIN-switch on the device.
 * `can_approve_discounts` (`discount.override`) and `max_discount_percent` (the role
 * limit) are UI hints for the discount-approver picker; `can_approve_voids` (`sale.void`)
 * and `can_approve_refunds` (`sale.refund`) for the void and refund pickers (Phase 7).
 * Load `role.permissions`.
 *
 * @mixin User
 */
class PinUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;

        return [
            'id' => $user->id,
            'name' => $user->name,
            'role' => [
                'slug' => $user->role->slug,
                'name' => $user->role->name,
            ],
            'can_approve_discounts' => $user->hasPermission('discount.override'),
            'max_discount_percent' => (int) $user->role->max_discount_percent,
            // Phase 7: UI hints for the void and refund approver pickers.
            'can_approve_voids' => $user->hasPermission('sale.void'),
            'can_approve_refunds' => $user->hasPermission('sale.refund'),
        ];
    }
}
