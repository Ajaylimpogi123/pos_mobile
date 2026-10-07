<?php

namespace App\Policies;

use App\Models\PurchaseRequest;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Purchase requests (Ingredients, Recipes & Purchasing → E, F).
 *
 * - Reads (list, detail): any purchase permission, or `report.view`.
 * - Create: `purchase.request`.
 * - Edit and cancel: the requester (still holding `purchase.request`) or `purchase.approve`.
 * - Decide items: `purchase.approve`, and on your own PR also `purchase.approve_own`
 *   (`403 Someone else must approve your own request.`). Only the Owner holds that.
 */
class PurchaseRequestPolicy
{
    public const MESSAGE_SELF_APPROVAL = 'Someone else must approve your own request.';

    /**
     * The purchase permissions ("any purchase permission").
     */
    public const PURCHASE_PERMISSIONS = ['purchase.request', 'purchase.approve', 'purchase.approve_own', 'purchase.receive'];

    public static function hasAnyPurchasePermission(User $user): bool
    {
        foreach (self::PURCHASE_PERMISSIONS as $slug) {
            if ($user->hasPermission($slug)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The purchasing reads: any purchase permission, or `report.view`.
     */
    public static function canReadPurchasing(User $user): bool
    {
        return self::hasAnyPurchasePermission($user) || $user->hasPermission('report.view');
    }

    /**
     * Deciding or approving a record `$ownerId` created: `purchase.approve`, plus
     * `purchase.approve_own` when the caller created it.
     */
    public static function approval(User $user, int $ownerId): Response
    {
        if (! $user->hasPermission('purchase.approve')) {
            return Response::deny();
        }

        if ($ownerId === $user->id && ! $user->hasPermission('purchase.approve_own')) {
            return Response::deny(self::MESSAGE_SELF_APPROVAL);
        }

        return Response::allow();
    }

    public function viewAny(User $user): bool
    {
        return self::canReadPurchasing($user);
    }

    public function view(User $user, PurchaseRequest $purchaseRequest): bool
    {
        return self::canReadPurchasing($user);
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('purchase.request');
    }

    /**
     * Edit (PATCH) or cancel (DELETE).
     */
    public function update(User $user, PurchaseRequest $purchaseRequest): bool
    {
        return $user->hasPermission('purchase.approve')
            || ($purchaseRequest->requested_by === $user->id && $user->hasPermission('purchase.request'));
    }

    public function decide(User $user, PurchaseRequest $purchaseRequest): Response
    {
        return self::approval($user, $purchaseRequest->requested_by);
    }
}
