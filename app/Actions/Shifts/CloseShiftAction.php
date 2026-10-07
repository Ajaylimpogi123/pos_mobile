<?php

namespace App\Actions\Shifts;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/shifts/{ulid}/close (Phase 6): records the close the tablet made (the
 * counted cash, the Z-read), possibly offline.
 *
 * - **The first count wins:** a shift that already has a counted cash figure is returned
 *   as stored, unchanged.
 * - **An open shift** is closed as sent: `closed_at`, `closed_by`, `counted_cash_cents` and
 *   `close_note`.
 * - **An auto-closed shift without a count** (its tablet opened the next shift first) gets
 *   the count, so a counted figure is never lost (Q-012, item 1): `counted_cash_cents`,
 *   `close_note` and `closed_by` are recorded, and `closed_at` becomes the body's time unless
 *   that is before `opened_at` (then the auto-close time stays). It keeps `auto_closed`.
 *
 * Each recorded close writes the `shift.closed` audit entry with the counted and expected
 * cash and the variance (from the live report); the actor is `closed_by`. The shift row is
 * locked, so two closes never both apply. The request has already checked the shift (the
 * caller's branch, the token's device) and, unless the shift is already counted, `closed_by`
 * (an active user of the branch).
 */
class CloseShiftAction
{
    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly BuildShiftReports $buildReports,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated CloseShiftRequest input
     */
    public function execute(Shift $shift, array $input, ?string $ip = null): Shift
    {
        return DB::transaction(function () use ($shift, $input, $ip): Shift {
            /** @var Shift $locked */
            $locked = Shift::query()->whereKey($shift->id)->lockForUpdate()->firstOrFail();

            if ($locked->counted_cash_cents !== null) {
                return $locked;
            }

            /** @var User $closer */
            $closer = User::query()->withTrashed()->findOrFail((int) $input['closed_by']);
            $closedAt = OpenShiftAction::instant((string) $input['closed_at']);
            $autoClosed = ! $locked->isOpen();

            // An auto-closed shift keeps its auto-close time when the tablet's time is before
            // the shift even opened.
            if ($autoClosed && $closedAt->lessThan($locked->opened_at)) {
                $closedAt = $locked->closed_at;
            }

            $locked->forceFill([
                'closed_at' => $closedAt,
                'closed_by' => $closer->id,
                'counted_cash_cents' => (int) $input['counted_cash_cents'],
                'close_note' => $input['close_note'] ?? null,
            ])->save();

            $this->buildReports->execute([$locked]);
            $report = $locked->computedReport();

            $this->recordAuditLog->execute(
                action: 'shift.closed',
                actor: $closer,
                subject: $locked,
                changes: [
                    'auto_closed' => $autoClosed,
                    'closed_at' => $locked->closed_at?->toIso8601ZuluString(),
                    'counted_cash_cents' => $locked->counted_cash_cents,
                    'expected_cash_cents' => $report['expected_cash_cents'],
                    'variance_cents' => $report['variance_cents'],
                ],
                ip: $ip,
            );

            return $locked;
        }, 3);
    }
}
