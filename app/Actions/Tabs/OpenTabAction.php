<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Actions\Reservations\EnsureTableNotHeld;
use App\Actions\Reservations\LockBookedReservation;
use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\DiningTable;
use App\Models\Tab;
use App\Models\TableReservation;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Opens a tab at a table (POST /api/v1/tabs, Dine-in Tables & Tabs → D.1).
 *
 * In one transaction the table's row is locked (deactivating or deleting it locks the same
 * row), and a table that already has an open tab is a `409 "Table 5 already has an open
 * bill."`. The tab is inserted with `open_table_id` = the table, whose UNIQUE index is the
 * backstop under concurrency (a violation is the same `409`). `guests` defaults to the
 * table's seats. Audit: `tab.opened`.
 *
 * Table Management → E (TM2):
 * - with `reservation_ulid`, the reservation (locked after the table) must still be `booked`
 *   (`409`) and be for this table (`422` on `table_id`: `This reservation is for Table 5.`);
 *   `guests` then defaults to its `party_size`, and on success it becomes `seated` with the
 *   tab's id (audit `reservation.seated`);
 * - without it, a table held by a booked reservation is a `409` (EnsureTableNotHeld).
 *
 * A ULID that is already recorded (a key released after the commit) returns that tab; one of
 * another branch is a `409`, as for sales.
 */
class OpenTabAction
{
    public const MESSAGE_OCCUPIED = 'Table %s already has an open bill.';

    public const MESSAGE_OTHER_TABLE = 'This reservation is for Table %s.';

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly LockBookedReservation $lockBookedReservation,
        private readonly EnsureTableNotHeld $ensureTableNotHeld,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated OpenTabRequest input
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(User $actor, array $input, ?Device $device, ?string $ip = null): Tab
    {
        $ulid = (string) $input['ulid'];

        $recorded = $this->alreadyRecorded($ulid, $actor);

        if ($recorded !== null) {
            return $recorded;
        }

        try {
            return DB::transaction(fn (): Tab => $this->open($actor, $ulid, $input, $device, $ip), 3);
        } catch (UniqueConstraintViolationException $e) {
            $recorded = $this->alreadyRecorded($ulid, $actor);

            if ($recorded !== null) {
                return $recorded;
            }

            $name = DiningTable::query()->whereKey((int) $input['table_id'])->value('name');

            throw new ConflictException(sprintf(self::MESSAGE_OCCUPIED, $name));
        }
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function open(User $actor, string $ulid, array $input, ?Device $device, ?string $ip): Tab
    {
        $table = DiningTable::query()
            ->where('branch_id', $actor->branch_id)
            ->where('is_active', true)
            ->whereKey((int) $input['table_id'])
            ->lockForUpdate()
            ->first()
            ?? throw ValidationException::withMessages(['table_id' => trans('validation.exists', ['attribute' => 'table id'])]);

        $reservation = $this->reservation($actor, $table, $input['reservation_ulid'] ?? null);

        if ($table->hasOpenTab()) {
            throw new ConflictException(sprintf(self::MESSAGE_OCCUPIED, $table->name));
        }

        if ($reservation === null) {
            $this->ensureTableNotHeld->execute($table);
        }

        $tab = new Tab;
        $tab->forceFill([
            'ulid' => $ulid,
            'branch_id' => $actor->branch_id,
            'table_id' => $table->id,
            'open_table_id' => $table->id,
            'status' => Tab::STATUS_OPEN,
            'guests' => (int) ($input['guests'] ?? $reservation?->party_size ?? $table->seats),
            'customer_id' => $input['customer_id'] ?? null,
            'notes' => $input['notes'] ?? null,
            'rounds_count' => 0,
            'opened_by' => $actor->id,
            'opened_at' => now()->startOfSecond(),
            'device_id' => $device?->id,
        ])->save();

        $this->recordAuditLog->execute(
            action: 'tab.opened',
            actor: $actor,
            subject: $tab,
            changes: ['ulid' => $tab->ulid, 'table' => $table->name, 'guests' => $tab->guests],
            ip: $ip,
        );

        if ($reservation !== null) {
            $now = now()->startOfSecond();

            $reservation->forceFill([
                'status' => TableReservation::STATUS_SEATED,
                'tab_id' => $tab->id,
                'status_changed_by' => $actor->id,
                'status_changed_at' => $now,
                'updated_by' => $actor->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'reservation.seated',
                actor: $actor,
                subject: $reservation,
                changes: ['ulid' => $reservation->ulid, 'tab_ulid' => $tab->ulid, 'table' => $table->name],
                ip: $ip,
            );
        }

        return $tab->refresh()->load(Tab::RESOURCE_RELATIONS);
    }

    /**
     * The booked reservation being seated (locked), or null without `reservation_ulid`.
     *
     * @throws ConflictException when it is no longer booked
     * @throws ValidationException when it is for another table
     */
    private function reservation(User $actor, DiningTable $table, ?string $ulid): ?TableReservation
    {
        if ($ulid === null) {
            return null;
        }

        $found = TableReservation::query()
            ->where('branch_id', $actor->branch_id)
            ->where('ulid', strtoupper($ulid))
            ->first()
            ?? throw ValidationException::withMessages(['reservation_ulid' => trans('validation.exists', ['attribute' => 'reservation ulid'])]);

        $reservation = $this->lockBookedReservation->execute($found);

        if ($reservation->table_id !== $table->id) {
            $name = DiningTable::withTrashed()->whereKey($reservation->table_id)->value('name');

            throw ValidationException::withMessages(['table_id' => sprintf(self::MESSAGE_OTHER_TABLE, $name)]);
        }

        return $reservation;
    }

    /**
     * @throws ConflictException when the ULID belongs to another branch's tab
     */
    private function alreadyRecorded(string $ulid, User $actor): ?Tab
    {
        $tab = Tab::query()->where('ulid', $ulid)->first();

        if ($tab !== null && $tab->branch_id !== $actor->branch_id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        return $tab?->load(Tab::RESOURCE_RELATIONS);
    }
}
