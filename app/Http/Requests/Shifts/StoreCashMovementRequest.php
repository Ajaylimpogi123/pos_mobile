<?php

namespace App\Http\Requests\Shifts;

use App\Models\CashMovement;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Database\Query\Builder;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/shifts/{ulid}/cash-movements (permission `shift.open`, Phase 6): `ulid`,
 * `type` (`in|out`), `amount_cents`, `reason`, `occurred_at` and `user_id`. See
 * ShiftEventRequest for the order of the checks.
 *
 * A `ulid` already used for a movement of **another** shift is a `422` (`has already been
 * taken`); one of this shift is a repeat, which skips the `user_id` user check.
 */
class StoreCashMovementRequest extends ShiftEventRequest
{
    public const MAX_AMOUNT_CENTS = 100000000;

    public const MAX_REASON = 120;

    public function authorize(): bool
    {
        if (! $this->authorizeOnDevice('recordCashMovement')) {
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
        $shiftUlid = $this->shift()->ulid;

        return [
            'ulid' => [
                'bail', 'required', 'string', 'regex:'.Ulid::PATTERN,
                Rule::unique('cash_movements', 'ulid')->where(fn (Builder $query) => $query->where('shift_ulid', '!=', $shiftUlid)),
            ],
            'type' => ['required', 'string', Rule::in(CashMovement::TYPES)],
            'amount_cents' => ['required', 'integer:strict', 'min:1', 'max:'.self::MAX_AMOUNT_CENTS],
            'reason' => ['required', 'string', 'max:'.self::MAX_REASON],
            'occurred_at' => self::instantRules(),
            'user_id' => $this->branchUserRules($this->isRepeat($shiftUlid)),
        ];
    }

    private function isRepeat(string $shiftUlid): bool
    {
        $ulid = $this->input('ulid');

        return Ulid::isValid($ulid)
            && CashMovement::query()->where('ulid', $ulid)->where('shift_ulid', $shiftUlid)->exists();
    }
}
