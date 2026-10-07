<?php

namespace App\Actions\Sales;

use App\Actions\Inventory\RecordStockMovementAction;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * Puts a voided or refunded sale's stock back (Phase 7; PROJECT_MEMORY §4.5, §4.7): one
 * positive reversing movement per product (`void` referencing the order, or `refund`
 * referencing the refund), summed over the product's lines, at the line's unit cost
 * snapshot, each applied to its branch level. Runs inside the caller's transaction.
 *
 * Only the products the sale actually took stock from are returned: those with a `sale`
 * movement referencing the order (the `track_stock` products at the time of sale, online or
 * offline). So a reversal never returns stock that the sale never took, even when a
 * product's `track_stock` changed since, and the ledger always reconciles.
 *
 * Levels are locked in product order (StockLevel::lockOrCreate), as a sale locks them, so
 * concurrent writers cannot deadlock.
 */
class ReturnOrderStock
{
    public function __construct(private readonly RecordStockMovementAction $recordStockMovement) {}

    /**
     * @param  list<array{item: OrderItem, qty: int}>  $returns  The lines and the units coming back
     * @param  string  $type  StockMovement::TYPE_VOID or StockMovement::TYPE_REFUND
     * @param  Model  $reference  The order (void) or the refund
     */
    public function execute(Order $order, array $returns, string $type, Model $reference, User $actor, CarbonInterface $occurredAt): void
    {
        $stocked = StockMovement::query()
            ->where('reference_type', $order->getMorphClass())
            ->where('reference_id', $order->id)
            ->where('type', StockMovement::TYPE_SALE)
            ->distinct()
            ->pluck('product_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $qtyByProduct = [];
        $costByProduct = [];

        foreach ($returns as $return) {
            $item = $return['item'];

            if ($return['qty'] <= 0 || ! in_array($item->product_id, $stocked, true)) {
                continue;
            }

            $qtyByProduct[$item->product_id] = ($qtyByProduct[$item->product_id] ?? 0) + $return['qty'];
            $costByProduct[$item->product_id] ??= $item->unit_cost_cents;
        }

        ksort($qtyByProduct);

        foreach ($qtyByProduct as $productId => $qty) {
            $this->recordStockMovement->execute(
                level: StockLevel::lockOrCreate($order->branch_id, $productId),
                type: $type,
                qtyDelta: $qty,
                unitCostCents: $costByProduct[$productId],
                actor: $actor,
                occurredAt: $occurredAt,
                reference: $reference,
            );
        }
    }
}
