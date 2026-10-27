<?php

namespace App\Actions\Reservations;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Exceptions\ConflictException;
use App\Http\Requests\Reservations\ReservationRules;
use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\BusinessDay;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Books a table (POST /api/v1/reservations, Table Management → E.2).
 *
 * In one transaction the table's row is locked (opening a tab locks the same row), the clash
 * rule is checked (EnsureNoReservationClash), and the reservation is inserted `booked`, with
 * `business_date` = the branch business day of `reserved_for`. Audit: `reservation.created`.
 *
 * A ULID that is already recorded (a key released after the commit) returns that
 * reservation; one of another branch is a `409`, as for tabs.
 */
class CreateReservationAction
{
    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly EnsureNoReservationClash $ensureNoClash,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated StoreReservationRequest input
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(User $actor, array $input, ?string $ip = null): TableReservation
    {
        $ulid = (string) $input['ulid'];

        return $this->alreadyRecorded($ulid, $actor)
            ?? DB::transaction(fn (): TableReservation => $this->create($actor, $ulid, $input, $ip), 3);
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function create(User $actor, string $ulid, array $input, ?string $ip): TableReservation
    {
        $table = DiningTable::query()
            ->where('branch_id', $actor->branch_id)
            ->where('is_active', true)
            ->whereKey((int) $input['table_id'])
            ->lockForUpdate()
            ->first()
            ?? throw ValidationException::withMessages(['table_id' => trans('validation.exists', ['attribute' => 'table id'])]);

        $at = ReservationRules::instant((string) $input['reserved_for']);

        $this->ensureNoClash->execute($table, $at);

        $branch = Branch::query()->findOrFail($actor->branch_id);

        $reservation = new TableReservation;
        $reservation->forceFill([
            'ulid' => $ulid,
            'branch_id' => $actor->branch_id,
            'table_id' => $table->id,
            'guest_name' => (string) $input['guest_name'],
            'phone' => $input['phone'] ?? null,
            'party_size' => (int) $input['party_size'],
            'reserved_for' => $at,
            'business_date' => BusinessDay::forBranch($branch)->dateOf($at),
            'notes' => $input['notes'] ?? null,
            'status' => TableReservation::STATUS_BOOKED,
            'created_by' => $actor->id,
            'updated_by' => $actor->id,
        ])->save();

        $this->recordAuditLog->execute(
            action: 'reservation.created',
            actor: $actor,
            subject: $reservation,
            changes: [
                'ulid' => $reservation->ulid,
                'table' => $table->name,
                'guest_name' => $reservation->guest_name,
                'party_size' => $reservation->party_size,
                'reserved_for' => $at->toIso8601ZuluString(),
            ],
            ip: $ip,
        );

        return $reservation->refresh()->load(TableReservation::RESOURCE_RELATIONS);
    }

    /**
     * @throws ConflictException when the ULID belongs to another branch's reservation
     */
    private function alreadyRecorded(string $ulid, User $actor): ?TableReservation
    {
        $reservation = TableReservation::query()->where('ulid', $ulid)->first();

        if ($reservation !== null && $reservation->branch_id !== $actor->branch_id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        return $reservation?->load(TableReservation::RESOURCE_RELATIONS);
    }
}
