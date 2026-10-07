<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Supplier;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Creates a supplier (`supplier.created`) or applies a partial update (`supplier.updated`, only
 * the changed fields; a request that changes nothing writes nothing). Admin CRUD pattern.
 */
class SaveSupplierAction
{
    public const AUDITED_FIELDS = ['name', 'contact_person', 'contact_number', 'email', 'address', 'is_active'];

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     */
    public function create(array $attributes, User $actor, ?string $ip = null): Supplier
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): Supplier {
            $supplier = new Supplier;
            $supplier->fill($attributes);
            $supplier->forceFill(['created_by' => $actor->id, 'updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'supplier.created',
                actor: $actor,
                subject: $supplier,
                changes: ModelChanges::created($supplier, self::AUDITED_FIELDS),
                ip: $ip,
            );

            return $supplier;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     */
    public function update(Supplier $supplier, array $attributes, User $actor, ?string $ip = null): Supplier
    {
        return DB::transaction(function () use ($supplier, $attributes, $actor, $ip): Supplier {
            $supplier->fill($attributes);
            $changes = ModelChanges::diff($supplier);

            if ($changes === []) {
                return $supplier;
            }

            $supplier->forceFill(['updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'supplier.updated',
                actor: $actor,
                subject: $supplier,
                changes: $changes,
                ip: $ip,
            );

            return $supplier;
        });
    }
}
