<?php

namespace App\Policies;

use App\Models\Order;
use App\Models\User;

/**
 * Sales (Phase 3). Ringing up needs `sale.create`. Order history needs `sale.create` or
 * `report.view`: with `report.view` the caller sees every order of their branch, without
 * it only the orders they rang up (Order::visibleTo). An order the caller cannot see is
 * a 404, not a 403, so its existence is not revealed. Reviewing a flagged offline sale
 * (Phase 5) needs `order.review`, with the same visibility. The sales reports (Phase 6)
 * need `report.view`. Voids and refunds (Phase 7) start with `sale.create`, `sale.void` or
 * `sale.refund`, with the same visibility.
 */
class OrderPolicy
{
    /**
     * List orders, optionally filtered to one cashier: filtering on anyone but yourself
     * needs `report.view`.
     */
    public function viewAny(User $user, ?int $cashierId = null): bool
    {
        if (! $this->mayViewOrders($user)) {
            return false;
        }

        return $cashierId === null || $cashierId === $user->id || $user->hasPermission('report.view');
    }

    public function view(User $user, Order $order): bool
    {
        return $this->mayViewOrders($user)
            && $order->branch_id === $user->branch_id
            && ($order->user_id === $user->id || $user->hasPermission('report.view'));
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('sale.create');
    }

    /**
     * Mark a flagged offline sale reviewed (Phase 5): `order.review`, on an order the
     * caller can see. Without an order, only the permission is checked.
     */
    public function review(User $user, ?Order $order = null): bool
    {
        return $user->hasPermission('order.review')
            && ($order === null || $this->view($user, $order));
    }

    /**
     * Start a void (Phase 7): `sale.create` or `sale.void`, on an order the caller can see
     * (Order::visibleTo). Whether a manager's PIN is also needed is decided by
     * App\Actions\Sales\ApproveReversal. Without an order, only the permission is checked.
     */
    public function void(User $user, ?Order $order = null): bool
    {
        return ($user->hasPermission('sale.create') || $user->hasPermission('sale.void'))
            && ($order === null || $this->isVisible($user, $order));
    }

    /**
     * Start a refund (Phase 7): `sale.create` or `sale.refund`, on an order the caller can
     * see. As for voids, a manager's PIN may also be needed (ApproveReversal).
     */
    public function refund(User $user, ?Order $order = null): bool
    {
        return ($user->hasPermission('sale.create') || $user->hasPermission('sale.refund'))
            && ($order === null || $this->isVisible($user, $order));
    }

    /**
     * The sales reports and their CSV export (Phase 6): `report.view`. They cover the
     * caller's branch only.
     */
    public function viewSalesReports(User $user): bool
    {
        return $user->hasPermission('report.view');
    }

    private function mayViewOrders(User $user): bool
    {
        return $user->hasPermission('sale.create') || $user->hasPermission('report.view');
    }

    /**
     * The visibility rule of Order::visibleTo: the caller's branch, and the caller's own
     * orders unless they have `report.view`.
     */
    private function isVisible(User $user, Order $order): bool
    {
        return $order->branch_id === $user->branch_id
            && ($order->user_id === $user->id || $user->hasPermission('report.view'));
    }
}
