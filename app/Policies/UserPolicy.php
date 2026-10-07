<?php

namespace App\Policies;

use App\Models\User;

/**
 * Staff management (permission `user.manage`) plus the role hierarchy: acting on a
 * user whose role grants a permission the caller lacks is forbidden (403), and that
 * includes viewing them one at a time. Branch scoping is done by the `{user}` route
 * binding (another branch's user is a 404 before this policy runs); the self-protection
 * rules (409) are enforced by the actions.
 */
class UserPolicy
{
    /**
     * List the users of the caller's branch.
     */
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('user.manage');
    }

    public function view(User $user, User $target): bool
    {
        return $this->manages($user, $target);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('user.manage');
    }

    /**
     * Edit, including (de)activation and role changes.
     */
    public function update(User $user, User $target): bool
    {
        return $this->manages($user, $target);
    }

    public function delete(User $user, User $target): bool
    {
        return $this->manages($user, $target);
    }

    public function resetPassword(User $user, User $target): bool
    {
        return $this->manages($user, $target);
    }

    public function setPin(User $user, User $target): bool
    {
        return $this->manages($user, $target);
    }

    private function manages(User $user, User $target): bool
    {
        return $user->hasPermission('user.manage') && $user->canManage($target);
    }
}
