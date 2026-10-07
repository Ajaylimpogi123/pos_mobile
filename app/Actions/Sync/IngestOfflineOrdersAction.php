<?php

namespace App\Actions\Sync;

use App\Models\Device;
use App\Models\User;

/**
 * POST /api/v1/sync/orders (Phase 5): ingests a batch of offline sales, one at a time
 * and in the order sent, each in its own transaction (IngestOfflineOrderAction). One
 * order's failure never affects the others. The orders share one OfflineOrderBatch (the
 * products loaded up front, the cashier and customer lookups memoised), so the lookups
 * don't grow with the batch. Idempotent per order by its `ulid`: a
 * resubmitted sale comes back as `duplicate` (the batch does not use the
 * `Idempotency-Key` middleware).
 */
class IngestOfflineOrdersAction
{
    public function __construct(private readonly IngestOfflineOrderAction $ingestOrder) {}

    /**
     * @param  array<array-key, mixed>  $orders  The request's `orders` (1–50)
     * @return list<OfflineOrderResult> One result per submitted order, in the same order
     */
    public function execute(User $caller, Device $device, array $orders, ?string $ip = null): array
    {
        $caller->loadMissing('branch');

        // The batch's products in one query, and memoised cashier and customer lookups.
        $batch = OfflineOrderBatch::for($orders);

        $results = [];

        foreach (array_values($orders) as $order) {
            $results[] = $this->ingestOrder->execute($caller, $device, $order, $ip, $batch);
        }

        return $results;
    }
}
