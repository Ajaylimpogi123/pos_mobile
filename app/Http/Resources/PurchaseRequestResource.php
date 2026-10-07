<?php

namespace App\Http\Resources;

use App\Http\Resources\Concerns\PresentsTimeline;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `PurchaseRequest` (Ingredients, Recipes & Purchasing → F):
 *
 * `{ ulid, pr_no, status, requested_by{id,name}, date_needed, remarks, created_at, items[],
 *    purchase_order{ulid, po_no, status}|null, timeline[] }` (the timeline on list items too, Q-027).
 *
 * Item: `{ id, item{type,id,name}, supplier{id,name}, qty, unit, base_qty,
 * estimated_unit_price_cents, remarks, decision, decision_reason, decided_by{id,name}|null,
 * decided_at }`. An ingredient's quantities are strings with 3 decimals, a product's integers.
 *
 * Load PurchaseRequest::resourceRelations() first.
 *
 * @mixin PurchaseRequest
 */
class PurchaseRequestResource extends JsonResource
{
    use PresentsTimeline;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $order = $this->purchaseOrder;

        return [
            'ulid' => $this->ulid,
            'pr_no' => $this->pr_no,
            'status' => $this->status,
            'requested_by' => $this->userSummary($this->requester),
            'date_needed' => $this->date_needed?->format('Y-m-d'),
            'remarks' => $this->remarks,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'items' => $this->items->map(fn (PurchaseRequestItem $item) => [
                'id' => $item->id,
                'item' => $item->itemSummary(),
                'supplier' => ['id' => $item->supplier_id, 'name' => (string) $item->supplier?->name],
                'qty' => $item->presentQty((string) $item->qty),
                'unit' => $item->unit,
                'base_qty' => $item->presentQty((string) $item->base_qty),
                'estimated_unit_price_cents' => $item->estimated_unit_price_cents,
                'remarks' => $item->remarks,
                'decision' => $item->decision,
                'decision_reason' => $item->decision_reason,
                'decided_by' => $this->userSummary($item->decider),
                'decided_at' => $item->decided_at?->toIso8601ZuluString(),
            ])->values()->all(),
            'purchase_order' => $order === null ? null : [
                'ulid' => $order->ulid,
                'po_no' => $order->po_no,
                'status' => $order->status,
            ],
            'timeline' => $this->timeline($this->auditLogs),
        ];
    }
}
