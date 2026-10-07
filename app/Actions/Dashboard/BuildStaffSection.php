<?php

namespace App\Actions\Dashboard;

use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * The dashboard `staff` section: non-deleted users of one branch.
 *
 * Three aggregate queries: the totals row, every role with its user count (0 included,
 * ordered by role id), and the 5 most recent logins. `without_pin` and `never_logged_in`
 * count **active** users only.
 */
class BuildStaffSection
{
    public const RECENT_LOGINS_LIMIT = 5;

    /**
     * @return array<string, mixed>
     */
    public function execute(int $branchId): array
    {
        $totals = User::query()
            ->toBase()
            ->where('users.branch_id', $branchId)
            ->selectRaw('COUNT(*) AS total')
            ->selectRaw('SUM(users.is_active = 1) AS active')
            ->selectRaw('SUM(users.is_active = 1 AND users.pin_hash IS NULL) AS without_pin')
            ->selectRaw('SUM(users.is_active = 1 AND users.last_login_at IS NULL) AS never_logged_in')
            ->first();

        $total = (int) $totals->total;
        $active = (int) $totals->active;

        $byRole = Role::query()
            ->withCount(['users' => fn (Builder $query) => $query->where('branch_id', $branchId)])
            ->orderBy('id')
            ->get(['id', 'slug', 'name'])
            ->map(fn (Role $role) => [
                'role_id' => $role->id,
                'slug' => $role->slug,
                'name' => $role->name,
                'count' => (int) $role->users_count,
            ])
            ->all();

        $recentLogins = User::query()
            ->leftJoin('roles', 'roles.id', '=', 'users.role_id')
            ->where('users.branch_id', $branchId)
            ->whereNotNull('users.last_login_at')
            ->select(['users.id', 'users.name', 'users.last_login_at', 'roles.name AS role_name'])
            ->orderByDesc('users.last_login_at')
            ->orderByDesc('users.id')
            ->limit(self::RECENT_LOGINS_LIMIT)
            ->get()
            ->map(fn (User $user) => [
                'user_id' => $user->id,
                'name' => $user->name,
                'role_name' => $user->getAttribute('role_name'),
                'last_login_at' => $user->last_login_at?->toIso8601ZuluString(),
            ])
            ->all();

        return [
            'total' => $total,
            'active' => $active,
            'inactive' => $total - $active,
            'without_pin' => (int) $totals->without_pin,
            'never_logged_in' => (int) $totals->never_logged_in,
            'by_role' => $byRole,
            'recent_logins' => $recentLogins,
        ];
    }
}
