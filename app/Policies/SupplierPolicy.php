<?php

namespace App\Policies;

use App\Models\Supplier;
use App\Models\User;

/**
 * Suppliers (Ingredients, Recipes & Purchasing → C): managed with `supplier.manage`; listed and
 * read with `supplier.manage` or any purchase permission.
 */
class SupplierPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('supplier.manage') || PurchaseRequestPolicy::hasAnyPurchasePermission($user);
    }

    public function view(User $user, Supplier $supplier): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('supplier.manage');
    }

    public function update(User $user, Supplier $supplier): bool
    {
        return $user->hasPermission('supplier.manage');
    }

    public function delete(User $user, Supplier $supplier): bool
    {
        return $user->hasPermission('supplier.manage');
    }
}
