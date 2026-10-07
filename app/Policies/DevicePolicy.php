<?php

namespace App\Policies;

use App\Models\User;

/**
 * Devices (Phase 5). Any signed-in user may register the tablet they are using: the app
 * does it silently after login, session restore and a PIN switch. The device is always
 * created in, or matched against, the caller's own branch.
 */
class DevicePolicy
{
    public function register(User $user): bool
    {
        return true;
    }
}
