<?php

namespace App\Actions\Shifts;

use App\Actions\Audit\RecordAuditLog;
use App\Models\CashMovement;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/shifts/{ulid}/cash-movements (Phase 6): records cash put into (`in`) or
 * taken out of (`out`) the drawer, as made on the tablet.
 *
 * - **Idempotent by `ulid`:** a movement the server already has is returned as stored
 *   (`200`). The request has rejected a ULID already used for another shift (`422`).
 * - **Never rejected for the shift's state:** a movement for a closed shift is accepted
 *   and the shift is flagged `movement_after_close`.
 * - **Audit:** `shift.cash_in` or `shift.cash_out` on the shift, with the movement; the
 *   actor is the user who handled the cash (`user_id`).
 *
 * The request has already checked the shift (the caller's branch, the token's device) and
 * `user_id` (an active user of the branch).
 */
class RecordCashMovementAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $input  Validated StoreCashMovementRequest input
     * @return ShiftEventResult<CashMovement>
     */
    public function execute(Shift $shift, array $input, ?string $ip = null): ShiftEventResult
    {
        $ulid = (string) $input['ulid'];
        $known = $this->known($ulid);

        if ($known !== null) {
            return ShiftEventResult::repeated($known);
        }

        try {
            $movement = DB::transaction(fn (): CashMovement => $this->record($shift, $input, $ip), 3);
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent request stored the same movement first.
            $known = $this->known($ulid);

            if ($known === null) {
                throw $e;
            }

            return ShiftEventResult::repeated($known);
        }

        return ShiftEventResult::created($movement);
    }

    private function known(string $ulid): ?CashMovement
    {
        return CashMovement::query()->with('user')->where('ulid', $ulid)->first();
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function record(Shift $shift, array $input, ?string $ip): CashMovement
    {
        /** @var Shift $locked */
        $locked = Shift::query()->whereKey($shift->id)->lockForUpdate()->firstOrFail();

        /** @var User $user */
        $user = User::query()->withTrashed()->findOrFail((int) $input['user_id']);

        $movement = new CashMovement;
        $movement->forceFill([
            'ulid' => (string) $input['ulid'],
            'shift_ulid' => $locked->ulid,
            'branch_id' => $locked->branch_id,
            'type' => (string) $input['type'],
            'amount_cents' => (int) $input['amount_cents'],
            'reason' => (string) $input['reason'],
            'user_id' => $user->id,
            'occurred_at' => OpenShiftAction::instant((string) $input['occurred_at']),
        ])->save();

        if (! $locked->isOpen()) {
            $locked->raiseFlag(Shift::FLAG_MOVEMENT_AFTER_CLOSE);
            $locked->save();
        }

        $this->recordAuditLog->execute(
            action: $movement->type === CashMovement::TYPE_IN ? 'shift.cash_in' : 'shift.cash_out',
            actor: $user,
            subject: $locked,
            changes: [
                'movement_ulid' => $movement->ulid,
                'amount_cents' => $movement->amount_cents,
                'reason' => $movement->reason,
                'occurred_at' => $movement->occurred_at->toIso8601ZuluString(),
                'after_close' => ! $locked->isOpen(),
            ],
            ip: $ip,
        );

        return $movement->setRelation('user', $user);
    }
}
