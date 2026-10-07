<?php

namespace App\Http\Requests\Inventory;

use App\Http\Requests\CursorListRequest;
use App\Models\Ingredient;
use App\Models\StockMovement;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/inventory/ingredients/{ingredient}/movements (`inventory.adjust` or
 * `report.view`): `per_page`, `cursor` and `type` (any movement type).
 */
class ListIngredientMovementsRequest extends CursorListRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewInventory', $this->ingredient()) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'type' => ['sometimes', 'string', Rule::in(StockMovement::TYPES)],
        ];
    }

    public function ingredient(): Ingredient
    {
        /** @var Ingredient */
        return $this->route('ingredient');
    }

    public function type(): ?string
    {
        $value = $this->validated('type');

        return $value === null ? null : (string) $value;
    }
}
