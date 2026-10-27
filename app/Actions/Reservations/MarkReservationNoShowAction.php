<?php

namespace App\Actions\Reservations;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Branch;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\ReservationTime;
use Illuminate\Support\Facades\DB;

/**
 * Marks a booked reservation as a no-show (POST /api/v1/reservations/{ulid}/no-show, Table
 * Management → E.5). Not booked: `409 "This reservation is no longer booked."`; before its
 * time: `409 "It isn't 7:00 PM yet."`. Audit: `reservation.no_show`.
 */
class MarkReservationNoShowAction
{
    public const MESSAGE_TOO_EARLY = "It isn't %s yet.";

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly LockBookedReservation $lockBookedReservation,
    ) {}

    /**
     * @throws ConflictException
     */
    public function execute(TableReservation $reservation, User $actor, ?string $ip = null): TableReservation
    {
        return DB::transaction(function () use ($reservation, $actor, $ip): TableReservation {
            $locked = $this->lockBookedReservation->execute($reservation);

            if (now()->lt($locked->reserved_for)) {
                throw new ConflictException(sprintf(
                    self::MESSAGE_TOO_EARLY,
                    ReservationTime::label($locked->reserved_for, Branch::query()->find($locked->branch_id)),
                ));
            }

            $locked->forceFill([
                'status' => TableReservation::STATUS_NO_SHOW,
                'status_changed_by' => $actor->id,
                'status_changed_at' => now()->startOfSecond(),
                'updated_by' => $actor->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'reservation.no_show',
                actor: $actor,
                subject: $locked,
                changes: ['ulid' => $locked->ulid],
                ip: $ip,
            );

            return $locked->refresh()->load(TableReservation::RESOURCE_RELATIONS);
        });
    }
}
