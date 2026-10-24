<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\DiningTable;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Partially updates a dine-in table (Dine-in Tables & Tabs → B) and writes the
 * `table.updated` audit entry (`{ field: {from, to} }`) when something changed.
 *
 * Deactivating a table with an open tab is a `409 "Table 5 has an open bill."`, checked
 * under the table's row lock (opening a tab locks the same row). Renaming a table with an
 * open tab is allowed: orders settled earlier keep the old name in `table_no`.
 */
class UpdateDiningTableAction
{
    public const MESSAGE_OPEN_BILL = 'Table %s has an open bill.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     *
     * @throws ConflictException
     */
    public function execute(DiningTable $table, array $attributes, User $actor, ?string $ip = null): DiningTable
    {
        return DB::transaction(function () use ($table, $attributes, $actor, $ip): DiningTable {
            /** @var DiningTable $locked */
            $locked = DiningTable::query()->whereKey($table->id)->lockForUpdate()->firstOrFail();
            $locked->fill($attributes);

            if ($locked->isDirty('is_active') && ! $locked->is_active && $locked->hasOpenTab()) {
                throw new ConflictException(sprintf(self::MESSAGE_OPEN_BILL, $locked->getOriginal('name')));
            }

            $changes = ModelChanges::diff($locked);

            if ($changes !== []) {
                $locked->forceFill(['updated_by' => $actor->id])->save();

                $this->recordAuditLog->execute(
                    action: 'table.updated',
                    actor: $actor,
                    subject: $locked,
                    changes: $changes,
                    ip: $ip,
                );
            }

            return $locked->refresh();
        });
    }
}
