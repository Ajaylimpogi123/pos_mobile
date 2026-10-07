<?php

namespace App\Http\Requests\Inventory;

use App\Http\Requests\CursorListRequest;
use App\Models\Product;
use App\Models\StockMovement;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/inventory/{product}/movements (Inventory, v1 completion; `inventory.adjust` or
 * `report.view`): `per_page`, `cursor` and `type` (any movement type).
 */
class ListStockMovementsRequest extends CursorListRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewInventory', $this->product()) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'type' => ['sometimes', 'string', Rule::in(StockMovement::TYPES)],
        ];
    }

    public function product(): Product
    {
        /** @var Product */
        return $this->route('product');
    }

    public function type(): ?string
    {
        $value = $this->validated('type');

        return $value === null ? null : (string) $value;
    }
}
