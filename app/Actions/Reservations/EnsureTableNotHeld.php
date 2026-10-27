<?php

namespace App\Actions\Reservations;

use App\Exceptions\ConflictException;
use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\TableReservation;
use App\Support\BranchSettings;
use App\Support\ReservationTime;

/**
 * The hold (Table Management → E): while a booked reservation holds a table (from
 * `reservation_hold_minutes` before its time until its slot ends), opening a tab on it
 * without that reservation, or transferring a tab onto it, is a
 * `409 "Table 5 is reserved for Santos at 7:00 PM."`. Call it under the table's row lock
 * (booking a reservation locks the same row).
 */
class EnsureTableNotHeld
{
    public const MESSAGE_HELD = 'Table %s is reserved for %s at %s.';

    /**
     * @throws ConflictException
     */
    public function execute(DiningTable $table): void
    {
        $branch = Branch::query()->findOrFail($table->branch_id);
        $hold = BranchSettings::for($branch)->reservationHoldMinutes();

        $held = TableReservation::query()
            ->where('table_id', $table->id)
            ->held($hold)
            ->orderBy('reserved_for')
            ->orderBy('id')
            ->first();

        if ($held !== null) {
            throw new ConflictException(sprintf(
                self::MESSAGE_HELD,
                $table->name,
                $held->guest_name,
                ReservationTime::label($held->reserved_for, $branch),
            ));
        }
    }
}
