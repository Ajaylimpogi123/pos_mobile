<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\PurchaseOrderLine;
use App\Models\PurchaseRequestItem;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a supplier and writes a `supplier.deleted` audit entry. A supplier used on any
 * purchase request item or purchase order line can't be deleted (409): it is deactivated
 * instead. The supplier row is locked first, so a PR or PO created meanwhile is seen.
 */
class DeleteSupplierAction
{
    public const MESSAGE_IN_USE = 'This supplier is on purchase orders. Deactivate it instead.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when the supplier is on a PR or PO
     */
    public function execute(Supplier $supplier, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($supplier, $actor, $ip): void {
            Supplier::query()->whereKey($supplier->id)->lockForUpdate()->first();

            $inUse = PurchaseRequestItem::query()->where('supplier_id', $supplier->id)->exists()
                || PurchaseOrderLine::query()->where('supplier_id', $supplier->id)->exists();

            if ($inUse) {
                throw new ConflictException(self::MESSAGE_IN_USE);
            }

            $supplier->forceFill(['updated_by' => $actor->id])->save();
            $supplier->delete();

            $this->recordAuditLog->execute(
                action: 'supplier.deleted',
                actor: $actor,
                subject: $supplier,
                changes: ['name' => $supplier->name],
                ip: $ip,
            );
        });
    }
}
