<?php

namespace App\Policies;

use App\Models\Category;
use App\Models\User;

/**
 * Admin management of categories. Every action requires the `product.manage` permission.
 * The POS read endpoint (GET /api/v1/categories) needs only an authenticated, active user
 * and does not go through this policy.
 */
class CategoryPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('product.manage');
    }

    public function view(User $user, Category $category): bool
    {
        return $user->hasPermission('product.manage');
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('product.manage');
    }

    /**
     * Also covers uploading and removing the image.
     */
    public function update(User $user, Category $category): bool
    {
        return $user->hasPermission('product.manage');
    }

    public function delete(User $user, Category $category): bool
    {
        return $user->hasPermission('product.manage');
    }
}
