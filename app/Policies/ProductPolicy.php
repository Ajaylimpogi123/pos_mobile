<?php

namespace App\Policies;

use App\Models\Product;
use App\Models\User;

/**
 * Admin management of products. Every action requires the `product.manage` permission,
 * except stock adjustments and reorder levels (`inventory.adjust`), the Inventory module's
 * reads (`inventory.adjust` or `report.view`) and the inventory report (`report.view`). The POS read endpoint
 * (GET /api/v1/products) needs only an authenticated, active user and does not go
 * through this policy.
 */
class ProductPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('product.manage');
    }

    public function view(User $user, Product $product): bool
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
    public function update(User $user, Product $product): bool
    {
        return $user->hasPermission('product.manage');
    }

    public function delete(User $user, Product $product): bool
    {
        return $user->hasPermission('product.manage');
    }

    /**
     * Record a stock adjustment (Phase 3): `inventory.adjust`, not `product.manage`.
     */
    public function adjustStock(User $user, Product $product): bool
    {
        return $user->hasPermission('inventory.adjust');
    }

    /**
     * Read the Inventory module (list and movement history; Inventory, v1 completion):
     * `inventory.adjust` or `report.view`.
     */
    public function viewInventory(User $user, ?Product $product = null): bool
    {
        return $user->hasPermission('inventory.adjust') || $user->hasPermission('report.view');
    }

    /**
     * Set or clear a product's reorder level in the caller's branch: `inventory.adjust`.
     */
    public function setReorderLevel(User $user, Product $product): bool
    {
        return $user->hasPermission('inventory.adjust');
    }

    /**
     * The inventory report and its CSV export: `report.view`, as for the sales reports.
     */
    public function viewInventoryReport(User $user): bool
    {
        return $user->hasPermission('report.view');
    }
}
