<?php

namespace App\Http\Requests\Reports;

use App\Actions\Reports\InventoryReport;
use App\Models\Product;
use App\Support\StockStatus;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/reports/inventory and GET /api/v1/reports/inventory/export (Inventory, v1
 * completion; permission `report.view`): `from` and `to` with the sales reports' rules
 * (business dates, `to ≥ from`, at most 366 days counted inclusively, Q-013), plus the
 * optional `category_id` and `status` (`in_stock`, `low`, `out` or `alerts`, on the current
 * status). 403 is checked before validation. The errors of the export are JSON too.
 *
 * Ingredients, Recipes & Purchasing: `kind` (`products`, the default, or `ingredients`);
 * `category_id` is ignored with `ingredients` (Q-028).
 */
class InventoryReportRequest extends SalesReportRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('viewInventoryReport', Product::class) ?? false;
    }

    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['group_by']);

        return [
            ...$rules,
            'kind' => ['sometimes', 'string', Rule::in(InventoryReport::KINDS)],
            'category_id' => ['sometimes', 'integer'],
            'status' => ['sometimes', 'string', Rule::in(StockStatus::FILTERS)],
        ];
    }

    /**
     * `products` (the default) or `ingredients` (Ingredients, Recipes & Purchasing).
     */
    public function kind(): string
    {
        return (string) ($this->validated('kind') ?? InventoryReport::KIND_PRODUCTS);
    }

    public function categoryId(): ?int
    {
        $value = $this->validated('category_id');

        return $value === null ? null : (int) $value;
    }

    public function status(): ?string
    {
        $value = $this->validated('status');

        return $value === null ? null : (string) $value;
    }
}
