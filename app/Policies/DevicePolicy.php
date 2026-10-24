<?php

namespace App\Policies;

use App\Models\Device;
use App\Models\User;

/**
 * Devices.
 *
 * - Phase 5: any signed-in user may register the tablet they are using: the app does it
 *   silently after login, session restore and a PIN switch. The device is always created
 *   in, or matched against, the caller's own branch.
 * - Hardening & Pilot → C: any signed-in user sends the heartbeat of the device their token
 *   is bound to; the admin Devices endpoints need `system.manage` and the caller's branch
 *   (`{device}` resolves only within it, so another branch's device is a 404 first).
 */
class DevicePolicy
{
    public function register(User $user): bool
    {
        return true;
    }

    public function heartbeat(User $user): bool
    {
        return true;
    }

    public function viewAny(User $user): bool
    {
        return $user->hasPermission('system.manage');
    }

    /**
     * GET /admin/devices/{id} (Q-043): the caller's branch, or any branch with `branch.all`.
     */
    public function view(User $user, Device $device): bool
    {
        return $user->hasPermission('system.manage')
            && ($device->branch_id === (int) $user->branch_id || $user->hasPermission('branch.all'));
    }

    public function update(User $user, Device $device): bool
    {
        return $this->manages($user, $device);
    }

    public function retire(User $user, Device $device): bool
    {
        return $this->manages($user, $device);
    }

    public function restore(User $user, Device $device): bool
    {
        return $this->manages($user, $device);
    }

    private function manages(User $user, Device $device): bool
    {
        return $user->hasPermission('system.manage') && $device->branch_id === (int) $user->branch_id;
    }
}
