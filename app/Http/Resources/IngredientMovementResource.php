<?php

namespace App\Http\Resources;

use App\Models\GoodsReceipt;
use App\Models\Order;
use App\Models\PurchaseOrder;
use App\Models\Refund;
use App\Models\StockMovement;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET /api/v1/inventory/ingredients/{ingredient}/movements (Ingredients, Recipes &
 * Purchasing → D): the product movement item's fields, with base-unit quantities as strings
 * (3 decimals), plus `entered_qty`, `entered_unit` and `value_cents`:
 *
 * `{ ulid, type, qty_delta, qty_after, entered_qty, entered_unit, unit_cost_cents, value_cents,
 *    reason, occurred_at, created_by, reference }`
 *
 * `reference` is null, or `{ kind, ulid, label }`: `purchase_order` (a PO receipt: the PO's ulid
 * and `po_no`; Q-026), or as for products `order` / `refund` (the order's ulid; invoice_no or
 * order_no).
 *
 * @mixin StockMovement
 */
class IngredientMovementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'ulid' => $this->ulid,
            'type' => $this->type,
            'qty_delta' => Quantity::format((string) $this->qty_delta),
            'qty_after' => Quantity::format((string) $this->qty_after),
            'entered_qty' => $this->entered_qty === null ? null : Quantity::format((string) $this->entered_qty),
            'entered_unit' => $this->entered_unit,
            'unit_cost_cents' => $this->unit_cost_cents,
            'value_cents' => $this->value_cents,
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

        if ($reference instanceof GoodsReceipt && $reference->purchaseOrder instanceof PurchaseOrder) {
            return ['kind' => 'purchase_order', 'ulid' => $reference->purchaseOrder->ulid, 'label' => $reference->purchaseOrder->po_no];
        }

        [$kind, $order] = match (true) {
            $reference instanceof Order && in_array($this->type, [StockMovement::TYPE_SALE, StockMovement::TYPE_VOID], true) => ['order', $reference],
            $reference instanceof Refund => ['refund', $reference->order],
            default => [null, null],
        };

        if (! $order instanceof Order) {
            return null;
        }

        return ['kind' => $kind, 'ulid' => $order->ulid, 'label' => $order->invoice_no ?? $order->order_no];
    }
}
