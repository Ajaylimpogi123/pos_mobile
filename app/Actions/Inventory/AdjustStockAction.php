<?php

namespace App\Actions\Inventory;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Exceptions\ConflictException;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A manual stock change of a product in the caller's branch
 * (POST /api/v1/admin/products/{product}/stock-adjustments): an `adjustment` (Phase 3), or
 * since Inventory (v1 completion) a `receipt` (stock in), a `count` or a `wastage`.
 *
 * - The product must track stock, else 409.
 * - Under the level's row lock: a `qty_delta` may not take the stock below zero (422 on
 *   `qty_delta`); a `counted_qty` sets the delta to count − on hand and may not equal the
 *   stock on hand (422 on `counted_qty`). A `counted_qty` sent without `type` stays an
 *   `adjustment`.
 * - One movement of the requested type (with the reason, and the product's cost, or for a
 *   receipt the given unit cost, recorded on the movement only), the level update and the
 *   `stock.adjusted` audit entry (`{ qty: { from, to }, reason, type }`), in one transaction.
 */
class AdjustStockAction
{
    public const MESSAGE_NOT_TRACKED = "This product doesn't track stock.";

    public const MESSAGE_BELOW_ZERO = "Stock can't go below zero (%d on hand).";

    public const MESSAGE_ALREADY = 'Stock is already %d.';

    public function __construct(
        private readonly RecordStockMovementAction $recordStockMovement,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * Exactly one of `$qtyDelta` and `$countedQty` is given (validated by the request).
     *
     * @param  string  $type  StockMovement::TYPE_ADJUSTMENT, TYPE_RECEIPT, TYPE_COUNT or TYPE_WASTAGE
     * @param  int|null  $unitCostCents  A receipt's unit cost; null for the product's cost
     *
     * @throws ConflictException 409 when the product does not track stock
     * @throws ValidationException 422 on `qty_delta` or `counted_qty`
     */
    public function execute(
        Product $product,
        User $actor,
        string $ulid,
        ?int $qtyDelta,
        ?int $countedQty,
        ?string $reason,
        ?string $ip = null,
        string $type = StockMovement::TYPE_ADJUSTMENT,
        ?int $unitCostCents = null,
    ): StockAdjustmentResult {
        // Normally a retry never gets here: the idempotency middleware replays the stored
        // response. This covers a key released after the adjustment was already committed.
        $recorded = $this->alreadyRecorded($ulid, $product, $actor, $type);

        if ($recorded !== null) {
            return $recorded;
        }

        if (! $product->track_stock) {
            throw new ConflictException(self::MESSAGE_NOT_TRACKED);
        }

        $unitCost = $type === StockMovement::TYPE_RECEIPT ? ($unitCostCents ?? $product->cost_cents) : $product->cost_cents;

        return DB::transaction(function () use ($product, $actor, $ulid, $qtyDelta, $countedQty, $reason, $ip, $type, $unitCost): StockAdjustmentResult {
            $level = StockLevel::lockOrCreate($actor->branch_id, $product->id);
            $before = $level->wholeQty();

            if ($countedQty !== null) {
                if ($countedQty === $before) {
                    throw ValidationException::withMessages(['counted_qty' => sprintf(self::MESSAGE_ALREADY, $before)]);
                }

                $delta = $countedQty - $before;
            } else {
                $delta = (int) $qtyDelta;

                if ($before + $delta < 0) {
                    throw ValidationException::withMessages(['qty_delta' => sprintf(self::MESSAGE_BELOW_ZERO, $before)]);
                }
            }

            $movement = $this->recordStockMovement->execute(
                level: $level,
                type: $type,
                qtyDelta: $delta,
                unitCostCents: $unitCost,
                actor: $actor,
                occurredAt: now()->startOfSecond(),
                reason: $reason,
                ulid: $ulid,
            );

            $after = $before + $delta;

            $this->recordAuditLog->execute(
                action: 'stock.adjusted',
                actor: $actor,
                subject: $product,
                changes: ['qty' => ['from' => $before, 'to' => $after], 'reason' => $reason, 'type' => $type],
                ip: $ip,
            );

            return new StockAdjustmentResult($movement->setRelation('creator', $actor), $before, $after);
        }, 3);
    }

    /**
     * The movement already recorded with this ULID, rebuilt from the ledger, or null.
     *
     * @throws ConflictException when the ULID belongs to another movement (another type,
     *                           product or branch)
     */
    private function alreadyRecorded(string $ulid, Product $product, User $actor, string $type): ?StockAdjustmentResult
    {
        $movement = StockMovement::query()->where('ulid', $ulid)->first();

        if ($movement === null) {
            return null;
        }

        if ($movement->type !== $type
            || $movement->product_id !== $product->id
            || $movement->branch_id !== $actor->branch_id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        // The ledger is the truth: the stock after a movement is the sum up to it.
        $after = (int) StockMovement::query()
            ->where('branch_id', $movement->branch_id)
            ->where('product_id', $movement->product_id)
            ->where('id', '<=', $movement->id)
            ->sum('qty_delta');

        return new StockAdjustmentResult($movement->load('creator'), $after - $movement->wholeQtyDelta(), $after);
    }
}
