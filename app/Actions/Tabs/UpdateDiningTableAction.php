<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\DiningTable;
use App\Models\TableReservation;
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
 *
 * Table Management:
 * - deactivating a table with upcoming booked reservations (slot not ended) is a
 *   `409 "Table 5 has 2 upcoming reservations. Move or cancel them first."` (§E);
 * - changing its `area` takes it off the floor plan: `pos_x` and `pos_y` become null (§B).
 */
class UpdateDiningTableAction
{
    public const MESSAGE_OPEN_BILL = 'Table %s has an open bill.';

    public const MESSAGE_UPCOMING_RESERVATIONS = 'Table %s has %d upcoming reservations. Move or cancel them first.';

    public const MESSAGE_UPCOMING_RESERVATION = 'Table %s has 1 upcoming reservation. Move or cancel it first.';

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

            if ($locked->isDirty('is_active') && ! $locked->is_active) {
                self::ensureNoUpcomingReservations($locked, (string) $locked->getOriginal('name'));
            }

            if ($locked->isDirty('area')) {
                $locked->forceFill(['pos_x' => null, 'pos_y' => null]);
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

    /**
     * @throws ConflictException when the table has booked reservations whose slot hasn't ended
     */
    public static function ensureNoUpcomingReservations(DiningTable $table, string $name): void
    {
        $upcoming = TableReservation::query()->where('table_id', $table->id)->upcoming()->count();

        if ($upcoming > 0) {
            throw new ConflictException($upcoming === 1
                ? sprintf(self::MESSAGE_UPCOMING_RESERVATION, $name)
                : sprintf(self::MESSAGE_UPCOMING_RESERVATIONS, $name, $upcoming));
        }
    }
}
