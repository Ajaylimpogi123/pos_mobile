<?php

namespace App\Policies;

use App\Models\User;

class UserPolicy
{
    /**
     * List the users of the caller's branch.
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('user.manage');
    }
}
