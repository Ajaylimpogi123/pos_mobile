<?php

namespace App\Policies;

use App\Models\Ingredient;
use App\Models\User;

/**
 * Ingredients (Ingredients, Recipes & Purchasing → D).
 *
 * - Admin CRUD (and the image): `product.manage`. Reads also with `inventory.adjust`, any
 *   purchase permission or `report.view`.
 * - Ingredient inventory (mirrors Inventory, v1 completion): reads with `inventory.adjust` or
 *   `report.view`; stock adjustments and reorder levels with `inventory.adjust`.
 */
class IngredientPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('product.manage')
            || $user->hasPermission('inventory.adjust')
            || $user->hasPermission('report.view')
            || PurchaseRequestPolicy::hasAnyPurchasePermission($user);
    }

    public function view(User $user, Ingredient $ingredient): bool
    {
        return $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('product.manage');
    }

    /**
     * Also covers uploading and removing the image.
     */
    public function update(User $user, Ingredient $ingredient): bool
    {
        return $user->hasPermission('product.manage');
    }

    public function delete(User $user, Ingredient $ingredient): bool
    {
        return $user->hasPermission('product.manage');
    }

    /**
     * The ingredient inventory list, item and movement history.
     */
    public function viewInventory(User $user, ?Ingredient $ingredient = null): bool
    {
        return $user->hasPermission('inventory.adjust') || $user->hasPermission('report.view');
    }

    public function adjustStock(User $user, Ingredient $ingredient): bool
    {
        return $user->hasPermission('inventory.adjust');
    }

    /**
     * D1: set the ingredient's cost in the caller's branch.
     */
    public function setCost(User $user, Ingredient $ingredient): bool
    {
        return $user->hasPermission('inventory.adjust');
    }

    public function setReorderLevel(User $user, Ingredient $ingredient): bool
    {
        return $user->hasPermission('inventory.adjust');
    }
}
