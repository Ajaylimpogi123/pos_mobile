<?php

namespace App\Actions\Shifts;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\Shift;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/shifts (Phase 6): records a shift the tablet opened, possibly offline and
 * hours earlier, so it is never rejected for a business rule.
 *
 * - **Idempotent by `ulid`:** a shift the server already has is returned as stored (`200`).
 *   A ULID of another tablet's (or branch's) shift is a `409`.
 * - **One open shift per tablet:** the shift is created on the token's device. Of the
 *   device's open shifts, in `opened_at` order, every one but the newest is then
 *   **auto-closed** at the next one's `opened_at` (flag `auto_closed`, no counted cash),
 *   so the older shift is the one closed even when events arrive out of order (Q-012).
 * - **Audit:** `shift.opened`, and a `shift.closed` entry (`auto_closed: true`) for each
 *   auto-closed shift. The actor is the user who opened the shift (`opened_by`).
 *
 * The device row is locked for the transaction, so two opens of the same tablet never
 * interleave. The request has already checked `opened_by` (an active user of the branch).
 */
class OpenShiftAction
{
    public const MESSAGE_OTHER_TABLET = 'This shift belongs to another tablet.';

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly BuildShiftReports $buildReports,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated StoreShiftRequest input
     * @return ShiftEventResult<Shift>
     *
     * @throws ConflictException 409 when the ULID belongs to another tablet's shift
     */
    public function execute(User $caller, Device $device, array $input, ?string $ip = null): ShiftEventResult
    {
        $ulid = (string) $input['ulid'];
        $known = $this->known($ulid, $caller, $device);

        if ($known !== null) {
            return ShiftEventResult::repeated($known);
        }

        try {
            $shift = DB::transaction(fn (): Shift => $this->open($caller, $device, $input, $ip), 3);
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent request stored the same shift first.
            $known = $this->known($ulid, $caller, $device);

            if ($known === null) {
                throw $e;
            }

            return ShiftEventResult::repeated($known);
        }

        return ShiftEventResult::created($shift);
    }

    /**
     * The stored shift with this ULID, or null.
     *
     * @throws ConflictException when it belongs to another tablet or branch
     */
    public function known(string $ulid, User $caller, Device $device): ?Shift
    {
        $shift = Shift::query()->where('ulid', $ulid)->first();

        if ($shift !== null && ($shift->branch_id !== (int) $caller->branch_id || $shift->device_id !== $device->id)) {
            throw new ConflictException(self::MESSAGE_OTHER_TABLET);
        }

        return $shift;
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function open(User $caller, Device $device, array $input, ?string $ip): Shift
    {
        // Serialises every open of this tablet.
        Device::query()->whereKey($device->id)->lockForUpdate()->first();

        /** @var User $opener */
        $opener = User::query()->withTrashed()->findOrFail((int) $input['opened_by']);

        $shift = new Shift;
        $shift->forceFill([
            'ulid' => (string) $input['ulid'],
            'branch_id' => (int) $caller->branch_id,
            'device_id' => $device->id,
            'opened_at' => self::instant((string) $input['opened_at']),
            'opened_by' => $opener->id,
            'opening_float_cents' => (int) $input['opening_float_cents'],
            'synced_at' => CarbonImmutable::now()->startOfSecond(),
        ])->save();

        $this->recordAuditLog->execute(
            action: 'shift.opened',
            actor: $opener,
            subject: $shift,
            changes: [
                'device_id' => $device->id,
                'opened_at' => $shift->opened_at->toIso8601ZuluString(),
                'opening_float_cents' => $shift->opening_float_cents,
            ],
            ip: $ip,
        );

        $open = Shift::query()
            ->where('device_id', $device->id)
            ->whereNull('closed_at')
            ->orderBy('opened_at')
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->values();

        for ($i = 0; $i < $open->count() - 1; $i++) {
            $this->autoClose($open[$i], $open[$i + 1]->opened_at, $opener, $ip);
        }

        return $shift->refresh();
    }

    /**
     * Closes a shift left open when its tablet opened another one: at the next shift's
     * `opened_at`, flagged `auto_closed`, with no counted cash (so no variance).
     */
    private function autoClose(Shift $shift, CarbonInterface $closedAt, User $actor, ?string $ip): void
    {
        $shift->closed_at = $closedAt;
        $shift->raiseFlag(Shift::FLAG_AUTO_CLOSED);
        $shift->save();

        $this->buildReports->execute([$shift]);
        $report = $shift->computedReport();

        $this->recordAuditLog->execute(
            action: 'shift.closed',
            actor: $actor,
            subject: $shift,
            changes: [
                'auto_closed' => true,
                'closed_at' => $closedAt->toIso8601ZuluString(),
                'counted_cash_cents' => null,
                'expected_cash_cents' => $report['expected_cash_cents'],
                'variance_cents' => null,
            ],
            ip: $ip,
        );
    }

    /**
     * An ISO 8601 time from the tablet, in UTC to the second, stored as sent (Q-012).
     */
    public static function instant(string $value): CarbonImmutable
    {
        return CarbonImmutable::parse($value)->utc()->startOfSecond();
    }
}
