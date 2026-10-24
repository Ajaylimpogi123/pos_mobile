<?php

namespace App\Policies;

use App\Models\DiningTable;
use App\Models\User;

/**
 * Admin management of dine-in tables (Dine-in Tables & Tabs → B): `settings.manage`.
 * `{diningTable}` only resolves within the caller's branch (AppServiceProvider), so another
 * branch's table is a 404 before this runs. The Tables view (GET /tables) goes through
 * TabPolicy instead.
 */
class DiningTablePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('settings.manage');
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('settings.manage');
    }

    public function update(User $user, DiningTable $table): bool
    {
        return $user->hasPermission('settings.manage') && $table->branch_id === $user->branch_id;
    }

    public function delete(User $user, DiningTable $table): bool
    {
        return $user->hasPermission('settings.manage') && $table->branch_id === $user->branch_id;
    }
}
