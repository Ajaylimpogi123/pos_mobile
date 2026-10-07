<?php

namespace App\Policies;

use App\Models\Device;
use App\Models\Shift;
use App\Models\User;

/**
 * Cash shifts (Phase 6). Permissions are the seeded slugs:
 *
 * - `shift.open`: open a shift and record cash in and out (the X-read prints on the tablet);
 * - `shift.close`: close a shift (the Z-read prints on the tablet);
 * - `report.zread`: the shifts list and every shift's report.
 *
 * Any signed-in user may read a shift of **their own tablet** (the token's device). Every
 * rule is scoped to the caller's branch; the device checks of the writes (409) are made by
 * the FormRequests. Without a shift, only the permission is checked.
 */
class ShiftPolicy
{
    public function open(User $user): bool
    {
        return $user->hasPermission('shift.open');
    }

    public function recordCashMovement(User $user, ?Shift $shift = null): bool
    {
        return $user->hasPermission('shift.open') && ($shift === null || $this->sameBranch($user, $shift));
    }

    public function close(User $user, ?Shift $shift = null): bool
    {
        return $user->hasPermission('shift.close') && ($shift === null || $this->sameBranch($user, $shift));
    }

    public function viewAny(User $user): bool
    {
        return $user->hasPermission('report.zread');
    }

    /**
     * `report.zread`, or the shift belongs to the tablet the caller's token is bound to.
     */
    public function view(User $user, Shift $shift, ?Device $device = null): bool
    {
        return $this->sameBranch($user, $shift)
            && ($user->hasPermission('report.zread') || ($device !== null && $device->id === $shift->device_id));
    }

    private function sameBranch(User $user, Shift $shift): bool
    {
        return $shift->branch_id === (int) $user->branch_id;
    }
}
