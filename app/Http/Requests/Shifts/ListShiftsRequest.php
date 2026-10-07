<?php

namespace App\Http\Requests\Shifts;

use App\Http\Requests\CursorListRequest;
use App\Models\Shift;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/shifts (permission `report.zread`, Phase 6): `per_page`, `cursor`, and the
 * filters `business_date` (the business day of `opened_at`), `device_id` and `status`
 * (`open|closed`).
 */
class ListShiftsRequest extends CursorListRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Shift::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'business_date' => ['sometimes', 'date_format:Y-m-d'],
            'device_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', 'string', Rule::in(Shift::STATUSES)],
        ];
    }
}
