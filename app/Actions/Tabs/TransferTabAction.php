<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\DiningTable;
use App\Models\Tab;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Moves an open tab to another active, free table (POST /api/v1/tabs/{ulid}/transfer, T2,
 * Dine-in Tables & Tabs → D.8). Under the tab's and the target table's locks: an occupied
 * target is a `409 "Table 7 is occupied. Merge the bills instead."` (the UNIQUE
 * `open_table_id` is the backstop). Audit: `tab.transferred` (`{from, to}`: the tables'
 * names).
 */
class TransferTabAction
{
    public const MESSAGE_OCCUPIED = 'Table %s is occupied. Merge the bills instead.';

    public function __construct(
        private readonly LockOpenTab $lockOpenTab,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(Tab $tab, int $tableId, User $actor, ?string $ip = null): Tab
    {
        try {
            return DB::transaction(fn (): Tab => $this->transfer($tab, $tableId, $actor, $ip), 3);
        } catch (UniqueConstraintViolationException) {
            throw new ConflictException(sprintf(self::MESSAGE_OCCUPIED, DiningTable::query()->whereKey($tableId)->value('name')));
        }
    }

    private function transfer(Tab $tab, int $tableId, User $actor, ?string $ip): Tab
    {
        $locked = $this->lockOpenTab->execute($tab);

        $target = DiningTable::query()
            ->where('branch_id', $locked->branch_id)
            ->where('is_active', true)
            ->whereKey($tableId)
            ->lockForUpdate()
            ->first()
            ?? throw ValidationException::withMessages(['table_id' => trans('validation.exists', ['attribute' => 'table id'])]);

        if ($target->hasOpenTab()) {
            throw new ConflictException(sprintf(self::MESSAGE_OCCUPIED, $target->name));
        }

        $from = DiningTable::withTrashed()->whereKey($locked->table_id)->value('name');

        $locked->forceFill(['table_id' => $target->id, 'open_table_id' => $target->id])->save();

        $this->recordAuditLog->execute(
            action: 'tab.transferred',
            actor: $actor,
            subject: $locked,
            changes: ['from' => $from, 'to' => $target->name],
            ip: $ip,
        );

        return $locked->refresh()->load(Tab::RESOURCE_RELATIONS);
    }
}
