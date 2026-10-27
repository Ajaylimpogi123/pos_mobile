<?php

namespace App\Actions\Reservations;

use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\TableReservation;
use App\Support\ReservationTime;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * The clash rule (Table Management → E.2): another `booked` reservation on the same table less
 * than 120 minutes before or after this one is a `422` on `reserved_for`:
 * `Table 5 is already reserved at 7:00 PM.` (the other reservation's time). Call it under the
 * table's row lock, so two devices can't book the same slot at once.
 */
class EnsureNoReservationClash
{
    public const MESSAGE_CLASH = 'Table %s is already reserved at %s.';

    /**
     * @throws ValidationException
     */
    public function execute(DiningTable $table, CarbonImmutable $at, ?int $ignoreId = null): void
    {
        $clash = TableReservation::query()
            ->where('table_id', $table->id)
            ->where('status', TableReservation::STATUS_BOOKED)
            ->when($ignoreId !== null, fn ($query) => $query->whereKeyNot($ignoreId))
            ->where('reserved_for', '>', $at->subMinutes(TableReservation::SLOT_MINUTES))
            ->where('reserved_for', '<', $at->addMinutes(TableReservation::SLOT_MINUTES))
            ->orderBy('reserved_for')
            ->orderBy('id')
            ->first();

        if ($clash !== null) {
            throw ValidationException::withMessages(['reserved_for' => sprintf(
                self::MESSAGE_CLASH,
                $table->name,
                ReservationTime::label($clash->reserved_for, Branch::query()->find($table->branch_id)),
            )]);
        }
    }
}
