<?php

namespace App\Http\Requests\Shifts;

use App\Models\Shift;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/shifts (permission `shift.open`, Phase 6): `ulid`, `opened_at`, `opened_by`
 * and `opening_float_cents`. See ShiftEventRequest for the order of the checks. A repeat
 * (the ULID of a stored shift) skips the `opened_by` user check.
 */
class StoreShiftRequest extends ShiftEventRequest
{
    public const MAX_OPENING_FLOAT_CENTS = 100000000;

    public function authorize(): bool
    {
        return $this->authorizeOnDevice('open');
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'opened_at' => self::instantRules(),
            'opened_by' => $this->branchUserRules($this->isRepeat()),
            'opening_float_cents' => ['required', 'integer:strict', 'min:0', 'max:'.self::MAX_OPENING_FLOAT_CENTS],
        ];
    }

    private function isRepeat(): bool
    {
        $ulid = $this->input('ulid');

        return Ulid::isValid($ulid) && Shift::query()->where('ulid', $ulid)->exists();
    }
}
