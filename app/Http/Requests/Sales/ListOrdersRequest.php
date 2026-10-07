<?php

namespace App\Http\Requests\Sales;

use App\Http\Requests\CursorListRequest;
use App\Models\Order;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/orders (`sale.create` or `report.view`).
 *
 * Filtering on another cashier without `report.view` is a 403, checked by the
 * controller once `cashier_id` is known to be an integer. `needs_review` (Phase 5) is a
 * boolean filter (`true`/`false`/`1`/`0`). `status` (Phase 7) is one of Order::STATUSES.
 */
class ListOrdersRequest extends CursorListRequest
{
    protected array $booleanFilters = ['needs_review'];

    /**
     * Checked before validation, so a caller with neither permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Order::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'business_date' => ['sometimes', 'date_format:Y-m-d'],
            'cashier_id' => ['sometimes', 'integer'],
            'search' => ['sometimes', 'nullable', 'string', 'max:30'],
            'needs_review' => ['sometimes', 'boolean'],
            // Phase 7
            'status' => ['sometimes', 'string', Rule::in(Order::STATUSES)],
        ];
    }

    public function businessDate(): ?string
    {
        return $this->validated('business_date');
    }
}
