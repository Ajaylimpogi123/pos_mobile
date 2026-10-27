<?php

namespace App\Actions\Reservations;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\TableReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Cancels a booked reservation (POST /api/v1/reservations/{ulid}/cancel, Table Management →
 * E.4), keeping the optional `reason`. Not booked: `409 "This reservation is no longer
 * booked."`. Audit: `reservation.cancelled`.
 */
class CancelReservationAction
{
    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly LockBookedReservation $lockBookedReservation,
    ) {}

    /**
     * @throws ConflictException
     */
    public function execute(TableReservation $reservation, ?string $reason, User $actor, ?string $ip = null): TableReservation
    {
        return DB::transaction(function () use ($reservation, $reason, $actor, $ip): TableReservation {
            $locked = $this->lockBookedReservation->execute($reservation);

            $locked->forceFill([
                'status' => TableReservation::STATUS_CANCELLED,
                'cancel_reason' => $reason,
                'status_changed_by' => $actor->id,
                'status_changed_at' => now()->startOfSecond(),
                'updated_by' => $actor->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'reservation.cancelled',
                actor: $actor,
                subject: $locked,
                changes: ['ulid' => $locked->ulid, 'reason' => $reason],
                ip: $ip,
            );

            return $locked->refresh()->load(TableReservation::RESOURCE_RELATIONS);
        });
    }
}
