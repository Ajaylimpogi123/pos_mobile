<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\PurchaseOrder;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Approves or declines a pending purchase order (POST /api/v1/purchase-orders/{ulid}/approve,
 * /decline; Ingredients, Recipes & Purchasing → G) under its row lock. The permission and the
 * self-approval rule are PurchaseOrderPolicy's.
 *
 * - A PO that isn't pending approval: `409 This order is no longer pending approval.`
 *   (provisional wording, Q-030).
 * - Approve: every line needs a price (the ₱0 gate):
 *   `422 Set a price for every line before approving.` (on `lines`). Audit `po.approved`
 *   (`{ po_no, total_cents }`, plus `self_approved: true` when the caller created the PO).
 * - Decline: with a reason. Audit `po.declined` (`{ po_no, reason }`, plus `self_approved: true`
 *   likewise).
 */
class DecidePurchaseOrderAction
{
    public const MESSAGE_NOT_PENDING = 'This order is no longer pending approval.';

    public const MESSAGE_PRICE_REQUIRED = 'Set a price for every line before approving.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException
     * @throws ValidationException
     */
    public function approve(PurchaseOrder $purchaseOrder, User $actor, ?string $ip = null): PurchaseOrder
    {
        return DB::transaction(function () use ($purchaseOrder, $actor, $ip): PurchaseOrder {
            $this->lockPending($purchaseOrder);

            if ($purchaseOrder->lines()->where('unit_price_cents', 0)->exists()) {
                throw ValidationException::withMessages(['lines' => self::MESSAGE_PRICE_REQUIRED]);
            }

            $purchaseOrder->forceFill([
                'status' => PurchaseOrder::STATUS_APPROVED,
                'approved_by' => $actor->id,
                'approved_at' => now(),
            ])->save();

            $this->recordAuditLog->execute(
                action: 'po.approved',
                actor: $actor,
                subject: $purchaseOrder,
                changes: [
                    'po_no' => $purchaseOrder->po_no,
                    'total_cents' => $purchaseOrder->total_cents,
                    ...($purchaseOrder->created_by === $actor->id ? ['self_approved' => true] : []),
                ],
                ip: $ip,
            );

            return $purchaseOrder;
        });
    }

    /**
     * @throws ConflictException
     */
    public function decline(PurchaseOrder $purchaseOrder, string $reason, User $actor, ?string $ip = null): PurchaseOrder
    {
        return DB::transaction(function () use ($purchaseOrder, $reason, $actor, $ip): PurchaseOrder {
            $this->lockPending($purchaseOrder);

            $purchaseOrder->forceFill([
                'status' => PurchaseOrder::STATUS_DECLINED,
                'declined_by' => $actor->id,
                'declined_at' => now(),
                'decline_reason' => $reason,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'po.declined',
                actor: $actor,
                subject: $purchaseOrder,
                changes: [
                    'po_no' => $purchaseOrder->po_no,
                    'reason' => $reason,
                    ...($purchaseOrder->created_by === $actor->id ? ['self_approved' => true] : []),
                ],
                ip: $ip,
            );

            return $purchaseOrder;
        });
    }

    /**
     * @throws ConflictException
     */
    private function lockPending(PurchaseOrder $purchaseOrder): void
    {
        $locked = PurchaseOrder::query()->whereKey($purchaseOrder->id)->lockForUpdate()->firstOrFail();

        if ($locked->status !== PurchaseOrder::STATUS_PENDING) {
            throw new ConflictException(self::MESSAGE_NOT_PENDING);
        }
    }
}
