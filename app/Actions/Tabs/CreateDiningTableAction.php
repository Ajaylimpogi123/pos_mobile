<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Models\DiningTable;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Creates a dine-in table in the caller's branch (Dine-in Tables & Tabs → B) and writes the
 * `table.created` audit entry (the fields, as changes from `null`).
 */
class CreateDiningTableAction
{
    public const AUDITED_FIELDS = ['name', 'area', 'seats', 'sort_order', 'is_active'];

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     */
    public function execute(array $attributes, User $actor, ?string $ip = null): DiningTable
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): DiningTable {
            $table = new DiningTable;
            $table->fill($attributes);
            $table->forceFill([
                'branch_id' => $actor->branch_id,
                'created_by' => $actor->id,
                'updated_by' => $actor->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'table.created',
                actor: $actor,
                subject: $table,
                changes: ModelChanges::created($table, self::AUDITED_FIELDS),
                ip: $ip,
            );

            return $table->refresh();
        });
    }
}
