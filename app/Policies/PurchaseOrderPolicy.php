<?php

namespace App\Policies;

use App\Models\PurchaseOrder;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Purchase orders and receiving (Ingredients, Recipes & Purchasing → E, G, H, I).
 *
 * - Reads (list, detail): any purchase permission, or `report.view`.
 * - Edit while pending: `purchase.request` or `purchase.approve`.
 * - Approve / decline: `purchase.approve`, with the self-approval rule applied to `created_by`
 *   (the PR approver whose decision created the PO): `purchase.approve_own` is needed when the
 *   caller created it (403 `Someone else must approve your own request.`).
 * - Receive: `purchase.receive`.
 * - The purchasing report: `report.view` or `purchase.approve`.
 */
class PurchaseOrderPolicy
{
    public function viewAny(User $user): bool
    {
        return PurchaseRequestPolicy::canReadPurchasing($user);
    }

    public function view(User $user, PurchaseOrder $purchaseOrder): bool
    {
        return PurchaseRequestPolicy::canReadPurchasing($user);
    }

    public function update(User $user, PurchaseOrder $purchaseOrder): bool
    {
        return $user->hasPermission('purchase.request') || $user->hasPermission('purchase.approve');
    }

    public function approve(User $user, PurchaseOrder $purchaseOrder): Response
    {
        return PurchaseRequestPolicy::approval($user, $purchaseOrder->created_by);
    }

    public function decline(User $user, PurchaseOrder $purchaseOrder): Response
    {
        return PurchaseRequestPolicy::approval($user, $purchaseOrder->created_by);
    }

    public function receive(User $user, PurchaseOrder $purchaseOrder): bool
    {
        return $user->hasPermission('purchase.receive');
    }

    public function viewReport(User $user): bool
    {
        return $user->hasPermission('report.view') || $user->hasPermission('purchase.approve');
    }
}
