<?php

namespace App\Http\Requests\Purchasing;

use App\Http\Requests\CursorListRequest;
use App\Models\PurchaseRequest;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/purchase-requests (any purchase permission or `report.view`): `per_page`,
 * `cursor`, `status`, `supplier_id`, `search` (pr_no or an item's name), `mine` and
 * `needs_decision` (booleans).
 */
class ListPurchaseRequestsRequest extends CursorListRequest
{
    protected array $booleanFilters = ['mine', 'needs_decision'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', PurchaseRequest::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(PurchaseRequest::STATUSES)],
            'supplier_id' => ['sometimes', 'integer'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'mine' => ['sometimes', 'boolean'],
            'needs_decision' => ['sometimes', 'boolean'],
        ];
    }
}
