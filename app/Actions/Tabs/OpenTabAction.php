<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\DiningTable;
use App\Models\Tab;
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
 * A ULID that is already recorded (a key released after the commit) returns that tab; one of
 * another branch is a `409`, as for sales.
 */
class OpenTabAction
{
    public const MESSAGE_OCCUPIED = 'Table %s already has an open bill.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

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

        if ($table->hasOpenTab()) {
            throw new ConflictException(sprintf(self::MESSAGE_OCCUPIED, $table->name));
        }

        $tab = new Tab;
        $tab->forceFill([
            'ulid' => $ulid,
            'branch_id' => $actor->branch_id,
            'table_id' => $table->id,
            'open_table_id' => $table->id,
            'status' => Tab::STATUS_OPEN,
            'guests' => (int) ($input['guests'] ?? $table->seats),
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

        return $tab->refresh()->load(Tab::RESOURCE_RELATIONS);
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
