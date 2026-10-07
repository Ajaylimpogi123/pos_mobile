<?php

namespace App\Http\Requests\Inventory;

use App\Models\Ingredient;
use App\Rules\DecimalQuantity;
use App\Support\Quantity;
use App\Support\Units\UnitConversion;
use Brick\Math\BigDecimal;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PUT /api/v1/inventory/ingredients/{ingredient}/reorder-level (permission `inventory.adjust`):
 * `reorder_level` is `present` and either `null` (the alert is off) or a quantity
 * `{ qty, unit }` (`qty` ≥ 0 with at most 3 decimals; `unit` valid for the ingredient). It is
 * stored in the base unit: round_half_up(qty × factor, 3). The body layout is provisional
 * (Q-026).
 */
class UpdateIngredientReorderLevelRequest extends FormRequest
{
    use IngredientUnitRule;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('setReorderLevel', $this->ingredient()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'reorder_level' => ['present', 'nullable', 'array:qty,unit'],
            'reorder_level.qty' => ['required_with:reorder_level', new DecimalQuantity(allowZero: true)],
            'reorder_level.unit' => ['required_with:reorder_level', 'string', 'max:20', $this->ingredientUnit($this->ingredient())],
        ];
    }

    public function ingredient(): Ingredient
    {
        /** @var Ingredient */
        return $this->route('ingredient');
    }

    /**
     * The reorder level in base units (3 decimals), or null.
     */
    public function baseReorderLevel(): ?BigDecimal
    {
        $level = $this->validated('reorder_level');

        if ($level === null) {
            return null;
        }

        $unit = UnitConversion::forIngredient($this->ingredient(), (string) $level['unit']);

        return UnitConversion::toBase((string) Quantity::parseInput($level['qty']), (string) $unit?->factor);
    }
}
