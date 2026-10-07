<?php

namespace App\Http\Requests\Reports;

use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/reports/purchasing and /export (Ingredients, Recipes & Purchasing → I; `report.view`
 * or `purchase.approve`): `from` and `to` (the PR's created business date; the sales reports'
 * rules, at most 366 days inclusively), plus the optional filters `status` (the PR's),
 * `decision`, `po_status`, `receiving_status` (a PO or a line value), `supplier_id` and
 * `item_type` + `item_id` (sent together). 403 is checked before validation.
 */
class PurchasingReportRequest extends SalesReportRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('viewReport', PurchaseOrder::class) ?? false;
    }

    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['group_by']);

        return [
            ...$rules,
            'status' => ['sometimes', 'string', Rule::in(PurchaseRequest::STATUSES)],
            'decision' => ['sometimes', 'string', Rule::in(PurchaseRequestItem::DECISIONS)],
            'po_status' => ['sometimes', 'string', Rule::in(PurchaseOrder::STATUSES)],
            'receiving_status' => ['sometimes', 'string', Rule::in([...PurchaseOrder::RECEIVING_STATUSES, ...PurchaseOrderLine::RECEIVING_STATUSES])],
            'supplier_id' => ['sometimes', 'integer'],
            'item_type' => ['required_with:item_id', 'string', Rule::in([PurchaseRequestItem::ITEM_INGREDIENT, PurchaseRequestItem::ITEM_PRODUCT])],
            'item_id' => ['required_with:item_type', 'integer'],
        ];
    }

    /**
     * @return array{status: string|null, decision: string|null, po_status: string|null, receiving_status: string|null, supplier_id: int|null, item_type: string|null, item_id: int|null}
     */
    public function filters(): array
    {
        $string = fn (string $key): ?string => $this->validated($key) === null ? null : (string) $this->validated($key);
        $integer = fn (string $key): ?int => $this->validated($key) === null ? null : (int) $this->validated($key);

        return [
            'status' => $string('status'),
            'decision' => $string('decision'),
            'po_status' => $string('po_status'),
            'receiving_status' => $string('receiving_status'),
            'supplier_id' => $integer('supplier_id'),
            'item_type' => $string('item_type'),
            'item_id' => $integer('item_id'),
        ];
    }
}
