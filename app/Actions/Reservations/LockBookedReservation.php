<?php

namespace App\Actions\Reservations;

use App\Exceptions\ConflictException;
use App\Models\TableReservation;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Locks a reservation's row (FOR UPDATE, inside the caller's transaction) and checks that it
 * is still `booked`: updating, cancelling, marking a no-show or seating a reservation that
 * isn't is a `409 "This reservation is no longer booked."` (Table Management → E).
 */
class LockBookedReservation
{
    public const MESSAGE_NOT_BOOKED = 'This reservation is no longer booked.';

    /**
     * @throws ConflictException
     */
    public function execute(TableReservation $reservation): TableReservation
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('A reservation must be locked inside a transaction.');
        }

        /** @var TableReservation $locked */
        $locked = TableReservation::query()->whereKey($reservation->id)->lockForUpdate()->firstOrFail();

        if (! $locked->isBooked()) {
            throw new ConflictException(self::MESSAGE_NOT_BOOKED);
        }

        return $locked;
    }
}
