<?php

namespace App\Http\Requests\Purchasing;

use App\Http\Requests\CursorListRequest;
use App\Models\PurchaseOrder;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/purchase-orders (any purchase permission or `report.view`): `per_page`, `cursor`,
 * `status`, `receiving_status`, `supplier_id`, `search` (po_no, pr_no or an item's name) and
 * `to_receive` (boolean: approved and not fully received).
 */
class ListPurchaseOrdersRequest extends CursorListRequest
{
    protected array $booleanFilters = ['to_receive'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', PurchaseOrder::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(PurchaseOrder::STATUSES)],
            'receiving_status' => ['sometimes', 'string', Rule::in(PurchaseOrder::RECEIVING_STATUSES)],
            'supplier_id' => ['sometimes', 'integer'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'to_receive' => ['sometimes', 'boolean'],
        ];
    }
}
