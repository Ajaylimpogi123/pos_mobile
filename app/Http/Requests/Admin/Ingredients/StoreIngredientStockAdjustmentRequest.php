<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Http\Requests\Inventory\IngredientUnitRule;
use App\Models\Ingredient;
use App\Models\StockMovement;
use App\Rules\DecimalQuantity;
use App\Support\Quantity;
use App\Support\Ulid;
use App\Support\Units\ResolvedUnit;
use App\Support\Units\UnitConversion;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/ingredients/{ingredient}/stock-adjustments (permission `inventory.adjust`;
 * idempotent by `ulid`): `{ ulid, type?, qty, unit, reason }` (the body of Q-026), the product
 * endpoint's types and rules with a decimal quantity in a unit:
 *
 * | type | `qty` | reason |
 * |---|---|---|
 * | adjustment (default) | the signed change, ≠ 0 | required |
 * | count | the counted quantity, ≥ 0 (the server works out the change) | required |
 * | wastage | the change, < 0 (`Wastage must remove stock.`) | required |
 *
 * `qty` has at most 3 decimals and is at most 1,000,000 in size; `unit` must be valid for the
 * ingredient. `receipt` isn't accepted here (stock in comes from receiving):
 * `The selected type is invalid.`
 */
class StoreIngredientStockAdjustmentRequest extends FormRequest
{
    use IngredientUnitRule;
    use ValidatesIdempotencyKey;

    public const TYPES = [StockMovement::TYPE_ADJUSTMENT, StockMovement::TYPE_COUNT, StockMovement::TYPE_WASTAGE];

    public const MESSAGE_WASTAGE_SIGN = 'Wastage must remove stock.';

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('adjustStock', $this->ingredient()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $qty = match ($this->requestedType()) {
            StockMovement::TYPE_COUNT => ['required', 'bail', new DecimalQuantity(allowZero: true)],
            StockMovement::TYPE_WASTAGE => ['required', 'bail', new DecimalQuantity(allowNegative: true), $this->removesStock(...)],
            default => ['required', 'bail', new DecimalQuantity(allowNegative: true)],
        };

        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'type' => ['sometimes', 'nullable', 'string', Rule::in(self::TYPES)],
            'qty' => $qty,
            'unit' => ['required', 'string', 'max:20', $this->ingredientUnit($this->ingredient())],
            'reason' => ['required', 'string', 'max:255'],
        ];
    }

    private function removesStock(string $attribute, mixed $value, Closure $fail): void
    {
        $qty = Quantity::parseInput($value);

        if ($qty !== null && ! str_starts_with($qty, '-')) {
            $fail(self::MESSAGE_WASTAGE_SIGN);
        }
    }

    private function requestedType(): string
    {
        $type = $this->input('type');

        return is_string($type) && in_array($type, self::TYPES, true) ? $type : StockMovement::TYPE_ADJUSTMENT;
    }

    public function ingredient(): Ingredient
    {
        /** @var Ingredient */
        return $this->route('ingredient');
    }

    public function type(): string
    {
        return (string) ($this->validated('type') ?? StockMovement::TYPE_ADJUSTMENT);
    }

    /**
     * The entered `qty` (3 decimals).
     */
    public function qty(): string
    {
        return (string) Quantity::parseInput($this->validated('qty'));
    }

    public function unit(): ResolvedUnit
    {
        /** @var ResolvedUnit */
        return UnitConversion::forIngredient($this->ingredient(), (string) $this->validated('unit'));
    }

    public function reason(): string
    {
        return (string) $this->validated('reason');
    }
}
