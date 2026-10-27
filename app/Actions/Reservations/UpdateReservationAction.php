<?php

namespace App\Actions\Reservations;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Http\Requests\Reservations\ReservationRules;
use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\BusinessDay;
use App\Support\ModelChanges;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Partially updates a booked reservation (PATCH /api/v1/reservations/{ulid}, Table Management
 * → E.3). Under the reservation's lock (`409 "This reservation is no longer booked."`) and its
 * final table's lock, the clash rule is checked again on the final table and time, and
 * `business_date` follows `reserved_for`. Audit: `reservation.updated` (`{ field: {from, to} }`)
 * when something changed.
 */
class UpdateReservationAction
{
    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly LockBookedReservation $lockBookedReservation,
        private readonly EnsureNoReservationClash $ensureNoClash,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated input (only the fields sent)
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(TableReservation $reservation, array $input, User $actor, ?string $ip = null): TableReservation
    {
        return DB::transaction(function () use ($reservation, $input, $actor, $ip): TableReservation {
            $locked = $this->lockBookedReservation->execute($reservation);

            $table = DiningTable::query()
                ->where('branch_id', $locked->branch_id)
                ->when(array_key_exists('table_id', $input), fn ($query) => $query->where('is_active', true))
                ->whereKey((int) ($input['table_id'] ?? $locked->table_id))
                ->lockForUpdate()
                ->first()
                ?? throw ValidationException::withMessages(['table_id' => trans('validation.exists', ['attribute' => 'table id'])]);

            $at = array_key_exists('reserved_for', $input)
                ? ReservationRules::instant((string) $input['reserved_for'])
                : CarbonImmutable::instance($locked->reserved_for);

            $this->ensureNoClash->execute($table, $at, $locked->id);

            $branch = Branch::query()->findOrFail($locked->branch_id);
            $from = CarbonImmutable::instance($locked->reserved_for);

            $locked->forceFill([
                ...array_intersect_key($input, array_flip(['guest_name', 'phone', 'party_size', 'notes'])),
                'table_id' => $table->id,
                'reserved_for' => $at,
                'business_date' => BusinessDay::forBranch($branch)->dateOf($at),
            ]);

            $changes = ModelChanges::diff($locked);

            if (array_key_exists('reserved_for', $changes)) {
                $changes['reserved_for'] = ['from' => $from->toIso8601ZuluString(), 'to' => $at->toIso8601ZuluString()];
            }

            if ($changes !== []) {
                $locked->forceFill(['updated_by' => $actor->id])->save();

                $this->recordAuditLog->execute(
                    action: 'reservation.updated',
                    actor: $actor,
                    subject: $locked,
                    changes: $changes,
                    ip: $ip,
                );
            }

            return $locked->refresh()->load(TableReservation::RESOURCE_RELATIONS);
        }, 3);
    }
}
