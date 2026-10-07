<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Actions\Inventory\RecordStockMovementAction;
use App\Exceptions\ConflictException;
use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptLine;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records a goods receipt against an approved purchase order
 * (POST /api/v1/purchase-orders/{ulid}/receipts; Ingredients, Recipes & Purchasing → H), in one
 * transaction under the PO's and its lines' row locks:
 *
 * - The PO must be `approved`: `409 Approve the order before receiving.`
 * - A line's received total can't go below 0 (a correction): `422 Only <n> <unit> was received.`
 *   on `lines.{i}.qty`, `<n>` in the line's unit. Over-receiving is allowed.
 * - Per line: `base_qty` (converted), `cost_cents = round_half_up(unit_price_cents × base_qty /
 *   line_factor, 0)` (the line unit's exact factor; signed like the qty), an append-only
 *   `goods_receipt_lines` row, and a `receipt` stock movement referencing the receipt: for an
 *   ingredient its value and weighted-average cost (B; `unit_cost_cents` = the price of the entered
 *   unit), for a product its qty with `unit_cost_cents` per base unit. Then the line's
 *   `received_base_qty` / `received_cents` and both receiving statuses are recomputed.
 * - Stock levels are locked in item order (ingredients, then products by id), as sales lock
 *   products.
 * - Audit `po.received` (`{ receipt_ulid, lines: [{ po_line_id, item, qty, unit, reason }] }`).
 *
 * Idempotent by `ulid`: when the idempotency key was released after the commit, a receipt already
 * stored under this ULID for this PO returns the PO as it is; another PO's receipt ULID is a 409.
 */
class ReceiveGoodsAction
{
    public const MESSAGE_NOT_APPROVED = 'Approve the order before receiving.';

    public const MESSAGE_BELOW_ZERO = 'Only %s %s was received.';

    public function __construct(
        private readonly RecordStockMovementAction $recordStockMovement,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @param  list<GoodsReceiptLineInput>  $lines
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(PurchaseOrder $purchaseOrder, string $ulid, ?string $remarks, array $lines, User $actor, ?string $ip = null): PurchaseOrder
    {
        $existing = GoodsReceipt::query()->where('ulid', $ulid)->first();

        if ($existing !== null) {
            if ($existing->purchase_order_id !== $purchaseOrder->id) {
                throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
            }

            return $purchaseOrder;
        }

        return DB::transaction(function () use ($purchaseOrder, $ulid, $remarks, $lines, $actor, $ip): PurchaseOrder {
            $locked = PurchaseOrder::query()->whereKey($purchaseOrder->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== PurchaseOrder::STATUS_APPROVED) {
                throw new ConflictException(self::MESSAGE_NOT_APPROVED);
            }

            /** @var Collection<int, PurchaseOrderLine> $poLines */
            $poLines = PurchaseOrderLine::query()
                ->where('purchase_order_id', $purchaseOrder->id)
                ->with(['ingredient', 'product'])
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            foreach ($lines as $input) {
                $line = $poLines->get($input->purchaseOrderLineId);
                $received = BigDecimal::of((string) $line->received_base_qty)->plus($input->quantity->baseQty);

                if ($received->isNegative()) {
                    throw ValidationException::withMessages([
                        "lines.{$input->index}.qty" => sprintf(self::MESSAGE_BELOW_ZERO, $line->presentQty($line->receivedQty()), $line->unit),
                    ]);
                }
            }

            $now = now()->startOfSecond();

            $receipt = new GoodsReceipt;
            $receipt->forceFill([
                'ulid' => $ulid,
                'branch_id' => $purchaseOrder->branch_id,
                'purchase_order_id' => $purchaseOrder->id,
                'received_by' => $actor->id,
                'received_at' => $now,
                'remarks' => $remarks,
            ])->save();

            $ordered = collect($lines)->sortBy(function (GoodsReceiptLineInput $input) use ($poLines) {
                $line = $poLines->get($input->purchaseOrderLineId);

                return sprintf('%d-%020d', $line->isIngredient() ? 0 : 1, $line->itemId());
            });

            $audit = [];

            foreach ($ordered as $input) {
                /** @var PurchaseOrderLine $line */
                $line = $poLines->get($input->purchaseOrderLineId);
                $audit[] = $this->receiveLine($receipt, $line, $input, $actor, $now);
            }

            $purchaseOrder->forceFill(['receiving_status' => self::orderReceivingStatus($poLines)])->save();

            $this->recordAuditLog->execute(
                action: 'po.received',
                actor: $actor,
                subject: $purchaseOrder,
                changes: ['receipt_ulid' => $ulid, 'lines' => $audit],
                ip: $ip,
            );

            return $purchaseOrder;
        }, 3);
    }

    /**
     * @return array{po_line_id: int, item: string, qty: string, unit: string, reason: string|null}
     */
    private function receiveLine(GoodsReceipt $receipt, PurchaseOrderLine $line, GoodsReceiptLineInput $input, User $actor, \DateTimeInterface $now): array
    {
        $quantity = $input->quantity;
        $base = $quantity->baseQty;
        $lineFactor = BigDecimal::of((string) $line->unit_factor);
        $price = (int) $line->unit_price_cents;

        $cost = $base->multipliedBy($price)->dividedBy($lineFactor, 0, RoundingMode::HalfUp)->toInt();

        $receiptLine = new GoodsReceiptLine;
        $receiptLine->forceFill([
            'goods_receipt_id' => $receipt->id,
            'purchase_order_line_id' => $line->id,
            'qty' => $quantity->qty,
            'unit' => $quantity->unit->name,
            'unit_factor' => (string) BigDecimal::of($quantity->unit->factor)->toScale(12),
            'base_qty' => (string) $base,
            'cost_cents' => $cost,
            'reason' => $input->reason,
        ])->save();

        if ($line->isIngredient()) {
            // The price of the entered unit.
            $unitCost = BigDecimal::of($price)->multipliedBy($quantity->unit->factor)->dividedBy($lineFactor, 0, RoundingMode::HalfUp)->toInt();

            $this->recordStockMovement->executeForIngredient(
                level: StockLevel::lockOrCreateIngredient($receipt->branch_id, (int) $line->ingredient_id),
                type: StockMovement::TYPE_RECEIPT,
                qtyDelta: $base,
                valueCents: $cost,
                unitCostCents: $unitCost,
                actor: $actor,
                occurredAt: $now,
                enteredQty: $quantity->qty,
                enteredUnit: $quantity->unit->name,
                reference: $receipt,
                reason: $input->reason,
            );
        } else {
            // A product's cost per base unit (`pc`).
            $unitCost = BigDecimal::of($price)->dividedBy($lineFactor, 0, RoundingMode::HalfUp)->toInt();

            $this->recordStockMovement->execute(
                level: StockLevel::lockOrCreate($receipt->branch_id, (int) $line->product_id),
                type: StockMovement::TYPE_RECEIPT,
                qtyDelta: $base->toScale(0, RoundingMode::HalfUp)->toInt(),
                unitCostCents: $unitCost,
                actor: $actor,
                occurredAt: $now,
                reference: $receipt,
                reason: $input->reason,
            );
        }

        $received = BigDecimal::of((string) $line->received_base_qty)->plus($base);

        $line->forceFill([
            'received_base_qty' => (string) $received,
            'received_cents' => (int) $line->received_cents + $cost,
            'receiving_status' => PurchaseOrderLine::receivingStatusOf(
                PurchaseOrderLine::receivedQtyOf((string) $received, (string) $line->unit_factor),
                BigDecimal::of((string) $line->qty),
            ),
            'last_received_at' => $now,
        ])->save();

        return [
            'po_line_id' => $line->id,
            'item' => $line->itemName(),
            'qty' => $quantity->qty,
            'unit' => $quantity->unit->name,
            'reason' => $input->reason,
        ];
    }

    /**
     * `not_received` (every line pending), `fully_received` (every line complete or
     * over-received), else `partially_received`.
     *
     * @param  Collection<int, PurchaseOrderLine>  $lines
     */
    public static function orderReceivingStatus(Collection $lines): string
    {
        $statuses = $lines->pluck('receiving_status');

        return match (true) {
            $statuses->every(fn (string $status) => $status === PurchaseOrderLine::RECEIVING_PENDING) => PurchaseOrder::RECEIVING_NONE,
            $statuses->every(fn (string $status) => in_array($status, [PurchaseOrderLine::RECEIVING_COMPLETE, PurchaseOrderLine::RECEIVING_OVER], true)) => PurchaseOrder::RECEIVING_FULL,
            default => PurchaseOrder::RECEIVING_PARTIAL,
        };
    }
}
