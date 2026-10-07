<?php

namespace App\Policies;

use App\Models\Customer;
use App\Models\User;

/**
 * Customers are looked up by anyone logged in, added and edited at the counter
 * (`sale.create`), and deleted only by managers and owners (`customer.manage`).
 */
class CustomerPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Customer $customer): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('sale.create');
    }

    public function update(User $user, Customer $customer): bool
    {
        return $user->hasPermission('sale.create');
    }

    public function delete(User $user, Customer $customer): bool
    {
        return $user->hasPermission('customer.manage');
    }
}
