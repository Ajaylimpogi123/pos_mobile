<?php

namespace App\Actions\Inventory;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Sets or clears a product's reorder level in the caller's branch
 * (PUT /api/v1/inventory/{product}/reorder-level; Inventory, v1 completion).
 *
 * - The product must track stock, else 409 (`This product doesn't track stock.`).
 * - The level lives on the branch's `stock_levels` row, created at qty 0 when missing
 *   (StockLevel::lockOrCreate; no movement, so the ledger still reconciles), under its row
 *   lock.
 * - The `stock.reorder_level_changed` audit entry (`{ reorder_level: { from, to } }`) is
 *   written only when the value changes.
 */
class SetReorderLevelAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when the product does not track stock
     */
    public function execute(Product $product, User $actor, ?int $reorderLevel, ?string $ip = null): void
    {
        if (! $product->track_stock) {
            throw new ConflictException(AdjustStockAction::MESSAGE_NOT_TRACKED);
        }

        DB::transaction(function () use ($product, $actor, $reorderLevel, $ip): void {
            $level = StockLevel::lockOrCreate((int) $actor->branch_id, $product->id);
            $from = $level->reorder_level;

            if ($from === $reorderLevel) {
                return;
            }

            $level->forceFill(['reorder_level' => $reorderLevel])->save();

            $this->recordAuditLog->execute(
                action: 'stock.reorder_level_changed',
                actor: $actor,
                subject: $product,
                changes: ['reorder_level' => ['from' => $from, 'to' => $reorderLevel]],
                ip: $ip,
            );
        }, 3);
    }
}
