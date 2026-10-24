<?php

namespace App\Policies;

use App\Models\Tab;
use App\Models\User;

/**
 * Dine-in tabs and the Tables view (Dine-in Tables & Tabs → C/D): every action needs
 * `sale.create`, on a tab of the caller's branch. Cancelling a sent item also needs
 * `sale.void` or a manager's PIN, checked by App\Actions\Sales\ApproveReversal.
 */
class TabPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('sale.create');
    }

    public function view(User $user, Tab $tab): bool
    {
        return $user->hasPermission('sale.create') && $tab->branch_id === $user->branch_id;
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('sale.create');
    }

    public function update(User $user, Tab $tab): bool
    {
        return $user->hasPermission('sale.create') && $tab->branch_id === $user->branch_id;
    }
}
