<?php

namespace App\Http\Requests\Shifts;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/shifts/{ulid}/close (permission `shift.close`, Phase 6): `closed_at`,
 * `closed_by`, `counted_cash_cents` and an optional `close_note`. See ShiftEventRequest for
 * the order of the checks. Closing a shift that already has a count is a repeat (the first
 * count wins), which skips the `closed_by` user check. An auto-closed shift without a count
 * still takes one (Q-012), so it is checked like an open shift.
 */
class CloseShiftRequest extends ShiftEventRequest
{
    public const MAX_COUNTED_CASH_CENTS = 1000000000;

    public const MAX_CLOSE_NOTE = 255;

    public function authorize(): bool
    {
        if (! $this->authorizeOnDevice('close')) {
            return false;
        }

        $this->resolveShift();

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'closed_at' => self::instantRules(),
            'closed_by' => $this->branchUserRules($this->shift()->counted_cash_cents !== null),
            'counted_cash_cents' => ['required', 'integer:strict', 'min:0', 'max:'.self::MAX_COUNTED_CASH_CENTS],
            'close_note' => ['sometimes', 'nullable', 'string', 'max:'.self::MAX_CLOSE_NOTE],
        ];
    }
}
