<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use App\Models\User;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Decides purchase request items (POST /api/v1/purchase-requests/{ulid}/decisions; Ingredients,
 * Recipes & Purchasing → F), in one transaction under the PR's row lock. The caller's permission
 * and the self-approval rule are checked by PurchaseRequestPolicy::decide.
 *
 * - A cancelled PR is `409 This request was cancelled.`; an item already decided is
 *   `409 This item was already decided.` (nothing is written).
 * - Each item gets its decision, reason, decider and time, and a `pr.item_approved` /
 *   `pr.item_declined` audit entry (`{ item_id, item, reason }`, plus `self_approved: true` when
 *   the caller decides their own PR).
 * - When the last pending item is decided, the PR's `status` is set (`approved`, `declined` or
 *   `partially_approved`) and, when any item is approved, **one PO** is created in the same
 *   transaction (`po.created`): the approved items as lines, each keeping its supplier, qty and
 *   unit, with `unit_price_cents` = the estimate, else the item's last approved PO price for that
 *   unit in the branch, else 0. The caller is the PO's `created_by`.
 */
class DecidePurchaseRequestAction
{
    public const MESSAGE_ALREADY_DECIDED = 'This item was already decided.';

    public function __construct(
        private readonly AllocatePurchaseNumber $numbers,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @param  list<array{item_id: int, decision: string, reason: string|null}>  $decisions
     *
     * @throws ConflictException
     */
    public function execute(PurchaseRequest $purchaseRequest, array $decisions, User $actor, ?string $ip = null): PurchaseRequest
    {
        return DB::transaction(function () use ($purchaseRequest, $decisions, $actor, $ip): PurchaseRequest {
            $locked = PurchaseRequest::query()->whereKey($purchaseRequest->id)->lockForUpdate()->firstOrFail();

            if ($locked->status === PurchaseRequest::STATUS_CANCELLED) {
                throw new ConflictException(UpdatePurchaseRequestAction::MESSAGE_CANCELLED);
            }

            $items = PurchaseRequestItem::query()
                ->where('purchase_request_id', $purchaseRequest->id)
                ->with(['ingredient', 'product'])
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            foreach ($decisions as $decision) {
                if ($items->get($decision['item_id'])?->decision !== PurchaseRequestItem::DECISION_PENDING) {
                    throw new ConflictException(self::MESSAGE_ALREADY_DECIDED);
                }
            }

            $selfApproved = $purchaseRequest->requested_by === $actor->id;
            $now = now();

            foreach ($decisions as $decision) {
                /** @var PurchaseRequestItem $item */
                $item = $items->get($decision['item_id']);
                $item->forceFill([
                    'decision' => $decision['decision'],
                    'decision_reason' => $decision['reason'],
                    'decided_by' => $actor->id,
                    'decided_at' => $now,
                ])->save();

                $this->recordAuditLog->execute(
                    action: $decision['decision'] === PurchaseRequestItem::DECISION_APPROVED ? 'pr.item_approved' : 'pr.item_declined',
                    actor: $actor,
                    subject: $purchaseRequest,
                    changes: [
                        'item_id' => $item->id,
                        'item' => $item->itemName(),
                        'qty' => Quantity::normalize((string) $item->qty),
                        'unit' => $item->unit,
                        'reason' => $decision['reason'],
                        ...($selfApproved ? ['self_approved' => true] : []),
                    ],
                    ip: $ip,
                );
            }

            if ($items->contains(fn (PurchaseRequestItem $item) => $item->decision === PurchaseRequestItem::DECISION_PENDING)) {
                return $purchaseRequest;
            }

            $approved = $items->where('decision', PurchaseRequestItem::DECISION_APPROVED)->values();

            $purchaseRequest->forceFill(['status' => match (true) {
                $approved->count() === $items->count() => PurchaseRequest::STATUS_APPROVED,
                $approved->isEmpty() => PurchaseRequest::STATUS_DECLINED,
                default => PurchaseRequest::STATUS_PARTIALLY_APPROVED,
            }])->save();

            if ($approved->isNotEmpty()) {
                $this->createOrder($purchaseRequest, $approved->all(), $actor, $ip);
            }

            return $purchaseRequest;
        });
    }

    /**
     * @param  list<PurchaseRequestItem>  $items  The approved items
     */
    private function createOrder(PurchaseRequest $purchaseRequest, array $items, User $actor, ?string $ip): PurchaseOrder
    {
        $branchId = $purchaseRequest->branch_id;

        $order = new PurchaseOrder;
        $order->forceFill([
            'ulid' => (string) Str::ulid(),
            'branch_id' => $branchId,
            'po_no' => $this->numbers->purchaseOrder($branchId),
            'purchase_request_id' => $purchaseRequest->id,
            'status' => PurchaseOrder::STATUS_PENDING,
            'receiving_status' => PurchaseOrder::RECEIVING_NONE,
            'created_by' => $actor->id,
            'total_cents' => 0,
        ])->save();

        $total = 0;

        foreach ($items as $item) {
            $price = $item->estimated_unit_price_cents ?? $this->lastApprovedPrice($branchId, $item) ?? 0;
            $lineTotal = self::lineTotal($price, (string) $item->qty);
            $total += $lineTotal;

            $line = new PurchaseOrderLine;
            $line->forceFill([
                'purchase_order_id' => $order->id,
                'purchase_request_item_id' => $item->id,
                'ingredient_id' => $item->ingredient_id,
                'product_id' => $item->product_id,
                'supplier_id' => $item->supplier_id,
                'qty' => $item->qty,
                'unit' => $item->unit,
                'unit_factor' => $item->unit_factor,
                'base_qty' => $item->base_qty,
                'unit_price_cents' => $price,
                'line_total_cents' => $lineTotal,
                'received_base_qty' => 0,
                'received_cents' => 0,
                'receiving_status' => PurchaseOrderLine::RECEIVING_PENDING,
            ])->save();

            // The report's link from the item to its line (written once, never changed).
            $item->forceFill(['purchase_order_line_id' => $line->id])->save();
        }

        $order->forceFill(['total_cents' => $total])->save();

        $this->recordAuditLog->execute(
            action: 'po.created',
            actor: $actor,
            subject: $order,
            changes: ['po_no' => $order->po_no, 'pr_no' => $purchaseRequest->pr_no, 'lines' => count($items), 'total_cents' => $total],
            ip: $ip,
        );

        return $order;
    }

    /**
     * The item's price per `unit` on its most recently approved PO line in the branch, or null.
     */
    private function lastApprovedPrice(int $branchId, PurchaseRequestItem $item): ?int
    {
        $price = PurchaseOrderLine::query()
            ->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_order_lines.purchase_order_id')
            ->where('purchase_orders.branch_id', $branchId)
            ->where('purchase_orders.status', PurchaseOrder::STATUS_APPROVED)
            ->where($item->isIngredient() ? 'purchase_order_lines.ingredient_id' : 'purchase_order_lines.product_id', $item->itemId())
            ->where('purchase_order_lines.unit', $item->unit)
            ->orderByDesc('purchase_orders.approved_at')
            ->orderByDesc('purchase_order_lines.id')
            ->value('purchase_order_lines.unit_price_cents');

        return $price === null ? null : (int) $price;
    }

    /**
     * line_total_cents = round_half_up(unit_price_cents × qty, 0).
     */
    public static function lineTotal(int $unitPriceCents, string $qty): int
    {
        return Quantity::roundToInt(BigDecimal::of($qty)->multipliedBy($unitPriceCents));
    }
}
