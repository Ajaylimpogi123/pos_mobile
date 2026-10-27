<?php

namespace App\Policies;

use App\Models\Tab;
use App\Models\User;

/**
 * Dine-in tabs and the Tables view (Dine-in Tables & Tabs → C/D): every action needs
 * `sale.create`, on a tab of the caller's branch. Cancelling a sent item also needs
 * `sale.void` or a manager's PIN, checked by App\Actions\Sales\ApproveReversal.
 *
 * Table Management → A/D: the Tables view (GET /tables) is open to `sale.create` or
 * `report.view` (the Board reads it), and the status board summary needs `report.view`.
 */
class TabPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('sale.create');
    }

    /**
     * GET /api/v1/tables.
     */
    public function viewTables(User $user): bool
    {
        return $user->hasPermission('sale.create') || $user->hasPermission('report.view');
    }

    /**
     * GET /api/v1/tables/summary.
     */
    public function viewSummary(User $user): bool
    {
        return $user->hasPermission('report.view');
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
