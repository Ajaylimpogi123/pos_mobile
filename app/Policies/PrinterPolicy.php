<?php

namespace App\Policies;

use App\Models\Printer;
use App\Models\User;

/**
 * Admin management of printers (Phase 4). Every action requires the `settings.manage`
 * permission. Printers are branch-scoped: `{printer}` only resolves within the caller's
 * branch (AppServiceProvider), so another branch's printer is a 404 before this runs.
 * GET /api/v1/print-config needs only an authenticated, active user and does not go
 * through this policy.
 */
class PrinterPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('settings.manage');
    }

    public function view(User $user, Printer $printer): bool
    {
        return $user->hasPermission('settings.manage') && $printer->branch_id === $user->branch_id;
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('settings.manage');
    }

    public function update(User $user, Printer $printer): bool
    {
        return $user->hasPermission('settings.manage') && $printer->branch_id === $user->branch_id;
    }

    public function delete(User $user, Printer $printer): bool
    {
        return $user->hasPermission('settings.manage') && $printer->branch_id === $user->branch_id;
    }
}
