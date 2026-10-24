<?php

namespace App\Policies;

use App\Models\ErrorGroup;
use App\Models\User;

/**
 * The error log (Hardening & Pilot → B): every admin action needs `system.manage`. Which
 * groups a holder sees is decided by App\Actions\Errors\ErrorLogQuery (a group the caller
 * can't see is a 404 before this runs). POST /client-errors needs no permission.
 */
class ErrorGroupPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('system.manage');
    }

    public function view(User $user, ErrorGroup $group): bool
    {
        return $user->hasPermission('system.manage');
    }

    public function resolve(User $user, ErrorGroup $group): bool
    {
        return $user->hasPermission('system.manage');
    }

    public function reopen(User $user, ErrorGroup $group): bool
    {
        return $user->hasPermission('system.manage');
    }
}
