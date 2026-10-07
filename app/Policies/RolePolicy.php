<?php

namespace App\Policies;

use App\Models\User;

/**
 * The roles list feeds the staff form, so it needs `user.manage`.
 */
class RolePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('user.manage');
    }
}
