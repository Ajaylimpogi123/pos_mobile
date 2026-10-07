<?php

namespace App\Http\Resources;

use App\Models\Order;
use App\Models\Refund;
use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET /api/v1/inventory/{product}/movements (Inventory, v1 completion). Wraps a
 * StockMovement from App\Actions\Inventory\StockMovementHistory (with `qty_after`, the
 * running balance of the whole branch ledger, and the `creator` and `reference` relations).
 *
 * `reference` is null, or for a sale, a void or a refund `{ kind: "order" | "refund", ulid:
 * <the order's ulid>, label: <invoice_no, or order_no when the invoice is null> }`.
 *
 * @mixin StockMovement
 */
class StockMovementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'ulid' => $this->ulid,
            'type' => $this->type,
            'qty_delta' => $this->wholeQtyDelta(),
            'qty_after' => (int) $this->qty_after,
            'unit_cost_cents' => $this->unit_cost_cents,
            'reason' => $this->reason,
            'occurred_at' => $this->occurred_at->toIso8601ZuluString(),
            'created_by' => $this->creator === null
                ? null
                : ['id' => $this->creator->id, 'name' => $this->creator->name],
            'reference' => $this->referenceOf(),
        ];
    }

    /**
     * @return array{kind: string, ulid: string, label: string|null}|null
     */
    private function referenceOf(): ?array
    {
        $reference = $this->reference;

        [$kind, $order] = match (true) {
            $reference instanceof Order && in_array($this->type, [StockMovement::TYPE_SALE, StockMovement::TYPE_VOID], true) => ['order', $reference],
            $reference instanceof Refund && $this->type === StockMovement::TYPE_REFUND => ['refund', $reference->order],
            default => [null, null],
        };

        if (! $order instanceof Order) {
            return null;
        }

        return [
            'kind' => $kind,
            'ulid' => $order->ulid,
            'label' => $order->invoice_no ?? $order->order_no,
        ];
    }
}
