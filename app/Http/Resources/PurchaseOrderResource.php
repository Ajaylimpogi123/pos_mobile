<?php

namespace App\Http\Resources;

use App\Http\Resources\Concerns\PresentsTimeline;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptLine;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `PurchaseOrder` (Ingredients, Recipes & Purchasing → G, H):
 *
 * `{ ulid, po_no, status, receiving_status, purchase_request{ulid, pr_no}, created_by,
 *    approved_by, approved_at, decline_reason, expected_delivery_date, remarks, total_cents,
 *    lines[], receipts[], timeline[] }`
 *
 * - Line: `{ id, item{type,id,name}, supplier{id,name}, qty, unit, base_qty, unit_price_cents,
 *   line_total_cents, received_base_qty, received_qty, remaining_qty, receiving_status }`
 *   (an ingredient's quantities are strings with 3 decimals, a product's integers).
 * - Receipt (newest first; Q-027): `{ ulid, received_by{id,name},
 *   received_at, remarks, lines[{ po_line_id, qty, unit, base_qty, cost_cents, reason }] }`.
 * - `timeline[]`: the PO's audit entries (PresentsTimeline).
 *
 * Load PurchaseOrderQueries::RELATIONS first.
 *
 * @mixin PurchaseOrder
 */
class PurchaseOrderResource extends JsonResource
{
    use PresentsTimeline;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $lines = $this->lines->keyBy('id');

        return [
            'ulid' => $this->ulid,
            'po_no' => $this->po_no,
            'status' => $this->status,
            'receiving_status' => $this->receiving_status,
            'purchase_request' => [
                'ulid' => $this->purchaseRequest->ulid,
                'pr_no' => $this->purchaseRequest->pr_no,
            ],
            'created_by' => $this->userSummary($this->creator),
            'approved_by' => $this->userSummary($this->approver),
            'approved_at' => $this->approved_at?->toIso8601ZuluString(),
            'decline_reason' => $this->decline_reason,
            'expected_delivery_date' => $this->expected_delivery_date?->format('Y-m-d'),
            'remarks' => $this->remarks,
            'total_cents' => (int) $this->total_cents,
            'lines' => $this->lines->map(fn (PurchaseOrderLine $line) => [
                'id' => $line->id,
                'item' => $line->itemSummary(),
                'supplier' => ['id' => $line->supplier_id, 'name' => (string) $line->supplier?->name],
                'qty' => $line->presentQty((string) $line->qty),
                'unit' => $line->unit,
                'base_qty' => $line->presentQty((string) $line->base_qty),
                'unit_price_cents' => (int) $line->unit_price_cents,
                'line_total_cents' => (int) $line->line_total_cents,
                'received_base_qty' => $line->presentQty((string) $line->received_base_qty),
                'received_qty' => $line->presentQty($line->receivedQty()),
                'remaining_qty' => $line->presentQty($line->remainingQty()),
                'receiving_status' => $line->receiving_status,
            ])->values()->all(),
            'receipts' => $this->receipts->map(fn (GoodsReceipt $receipt) => [
                'ulid' => $receipt->ulid,
                'received_by' => $this->userSummary($receipt->receiver),
                'received_at' => $receipt->received_at->toIso8601ZuluString(),
                'remarks' => $receipt->remarks,
                'lines' => $receipt->lines->map(function (GoodsReceiptLine $receiptLine) use ($lines) {
                    /** @var PurchaseOrderLine|null $line */
                    $line = $lines->get($receiptLine->purchase_order_line_id);
                    $present = fn (string $value) => $line?->presentQty($value) ?? Quantity::format($value);

                    return [
                        'po_line_id' => $receiptLine->purchase_order_line_id,
                        'qty' => $present((string) $receiptLine->qty),
                        'unit' => $receiptLine->unit,
                        'base_qty' => $present((string) $receiptLine->base_qty),
                        'cost_cents' => (int) $receiptLine->cost_cents,
                        'reason' => $receiptLine->reason,
                    ];
                })->values()->all(),
            ])->values()->all(),
            'timeline' => $this->timeline($this->auditLogs),
        ];
    }
}
