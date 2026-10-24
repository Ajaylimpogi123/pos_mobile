<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\DiningTable;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a dine-in table (Dine-in Tables & Tabs → B) and writes the `table.deleted`
 * audit entry. A table with an open tab is a `409 "Table 5 has an open bill."`, checked
 * under the table's row lock.
 */
class DeleteDiningTableAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException
     */
    public function execute(DiningTable $table, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($table, $actor, $ip): void {
            /** @var DiningTable $locked */
            $locked = DiningTable::query()->whereKey($table->id)->lockForUpdate()->firstOrFail();

            if ($locked->hasOpenTab()) {
                throw new ConflictException(sprintf(UpdateDiningTableAction::MESSAGE_OPEN_BILL, $locked->name));
            }

            $locked->forceFill(['updated_by' => $actor->id])->save();
            $locked->delete();

            $this->recordAuditLog->execute(
                action: 'table.deleted',
                actor: $actor,
                subject: $locked,
                changes: ['name' => $locked->name],
                ip: $ip,
            );
        });
    }
}
