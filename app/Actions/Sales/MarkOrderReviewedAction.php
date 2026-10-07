<?php

namespace App\Actions\Sales;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/orders/{ulid}/review (Phase 5): a manager clears a flagged offline sale.
 * Sets `needs_review = false`, `reviewed_at` and `reviewed_by`, keeps `review_reasons`
 * for the record, and writes the `order.reviewed` audit entry with the reasons and the
 * note. The order is row-locked, so two managers cannot both review it.
 */
class MarkOrderReviewedAction
{
    public const MESSAGE_NOT_NEEDED = "This order doesn't need review.";

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when the order doesn't need review
     */
    public function execute(Order $order, User $reviewer, ?string $note, ?string $ip = null): Order
    {
        return DB::transaction(function () use ($order, $reviewer, $note, $ip): Order {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            if (! $locked->needs_review) {
                throw new ConflictException(self::MESSAGE_NOT_NEEDED);
            }

            $locked->forceFill([
                'needs_review' => false,
                'reviewed_at' => now(),
                'reviewed_by' => $reviewer->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'order.reviewed',
                actor: $reviewer,
                subject: $locked,
                changes: ['reasons' => $locked->review_reasons, 'note' => $note],
                ip: $ip,
            );

            return $locked->load(RecordOrder::RESOURCE_RELATIONS);
        });
    }
}
