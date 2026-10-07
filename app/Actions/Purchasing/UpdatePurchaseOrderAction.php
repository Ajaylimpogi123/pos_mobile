<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\User;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Edits a pending purchase order (PATCH /api/v1/purchase-orders/{ulid}; Ingredients, Recipes &
 * Purchasing → G) under its row lock: `expected_delivery_date`, `remarks`, and its lines by id
 * (qty, unit, unit price, supplier). Each changed line's `line_total_cents` and the PO's
 * `total_cents` are recomputed. A PO that isn't pending approval is
 * `409 An approved order can't be edited.` Audit `po.updated` with the changes (only when
 * something changed).
 */
class UpdatePurchaseOrderAction
{
    public const MESSAGE_NOT_EDITABLE = "An approved order can't be edited.";

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, string|null>  $fields
     * @param  array<int, array{quantity?: ResolvedQuantity, unit_price_cents?: int, supplier_id?: int}>  $lineChanges
     *
     * @throws ConflictException
     */
    public function execute(PurchaseOrder $purchaseOrder, array $fields, array $lineChanges, User $actor, ?string $ip = null): PurchaseOrder
    {
        return DB::transaction(function () use ($purchaseOrder, $fields, $lineChanges, $actor, $ip): PurchaseOrder {
            $locked = PurchaseOrder::query()->whereKey($purchaseOrder->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== PurchaseOrder::STATUS_PENDING) {
                throw new ConflictException(self::MESSAGE_NOT_EDITABLE);
            }

            $purchaseOrder->forceFill($fields);
            $changes = [];

            foreach (['expected_delivery_date', 'remarks'] as $field) {
                if ($purchaseOrder->isDirty($field)) {
                    $from = $purchaseOrder->getOriginal($field);
                    $to = $purchaseOrder->getAttribute($field);
                    $changes[$field] = [
                        'from' => $from instanceof \DateTimeInterface ? $from->format('Y-m-d') : $from,
                        'to' => $to instanceof \DateTimeInterface ? $to->format('Y-m-d') : $to,
                    ];
                }
            }

            $lines = $purchaseOrder->lines()->get()->keyBy('id');
            $lineAudit = [];

            foreach ($lineChanges as $lineId => $change) {
                /** @var PurchaseOrderLine $line */
                $line = $lines->get($lineId);
                $before = $this->describe($line);

                if (isset($change['quantity'])) {
                    $line->forceFill([
                        'qty' => $change['quantity']->qty,
                        'unit' => $change['quantity']->unit->name,
                        'unit_factor' => (string) BigDecimal::of($change['quantity']->unit->factor)->toScale(12),
                        'base_qty' => (string) $change['quantity']->baseQty,
                    ]);
                }

                if (isset($change['unit_price_cents'])) {
                    $line->forceFill(['unit_price_cents' => $change['unit_price_cents']]);
                }

                if (isset($change['supplier_id'])) {
                    $line->forceFill(['supplier_id' => $change['supplier_id']]);
                }

                $line->forceFill(['line_total_cents' => DecidePurchaseRequestAction::lineTotal((int) $line->unit_price_cents, (string) $line->qty)]);

                if ($line->isDirty()) {
                    $line->save();
                    $lineAudit[] = ['id' => $line->id, 'from' => $before, 'to' => $this->describe($line)];
                }
            }

            if ($lineAudit !== []) {
                $changes['lines'] = $lineAudit;
                $total = (int) $lines->sum(fn (PurchaseOrderLine $line) => (int) $line->line_total_cents);

                if ($total !== $purchaseOrder->total_cents) {
                    $changes['total_cents'] = ['from' => $purchaseOrder->total_cents, 'to' => $total];
                    $purchaseOrder->forceFill(['total_cents' => $total]);
                }
            }

            if ($changes === []) {
                return $purchaseOrder;
            }

            $purchaseOrder->isDirty() ? $purchaseOrder->save() : $purchaseOrder->touch();

            $this->recordAuditLog->execute(
                action: 'po.updated',
                actor: $actor,
                subject: $purchaseOrder,
                changes: $changes,
                ip: $ip,
            );

            return $purchaseOrder;
        });
    }

    /**
     * @return array{qty: string, unit: string, unit_price_cents: int, supplier_id: int}
     */
    private function describe(PurchaseOrderLine $line): array
    {
        return [
            'qty' => (string) $line->qty,
            'unit' => $line->unit,
            'unit_price_cents' => (int) $line->unit_price_cents,
            'supplier_id' => (int) $line->supplier_id,
        ];
    }
}
