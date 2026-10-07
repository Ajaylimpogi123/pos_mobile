<?php

namespace App\Http\Requests\Inventory;

use App\Http\Requests\CursorListRequest;
use App\Models\Ingredient;
use App\Support\StockStatus;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/inventory/ingredients (`inventory.adjust` or `report.view`): `per_page`, `cursor`,
 * `search` (name) and `status` (`in_stock`, `low`, `out` or `alerts`).
 */
class ListIngredientInventoryRequest extends CursorListRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewInventory', Ingredient::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'status' => ['sometimes', 'string', Rule::in(StockStatus::FILTERS)],
        ];
    }

    public function status(): ?string
    {
        $value = $this->validated('status');

        return $value === null ? null : (string) $value;
    }
}
