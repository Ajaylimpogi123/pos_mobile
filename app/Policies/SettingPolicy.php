<?php

namespace App\Policies;

use App\Models\User;

/**
 * The caller's branch settings (Phase 4: receipt settings). Viewing and changing them
 * through the admin endpoints requires `settings.manage`. The settings are always the
 * caller's own branch, so there is no model argument. GET /api/v1/print-config (which
 * also returns them) needs only an authenticated, active user.
 */
class SettingPolicy
{
    public function view(User $user): bool
    {
        return $user->hasPermission('settings.manage');
    }

    public function update(User $user): bool
    {
        return $user->hasPermission('settings.manage');
    }
}
