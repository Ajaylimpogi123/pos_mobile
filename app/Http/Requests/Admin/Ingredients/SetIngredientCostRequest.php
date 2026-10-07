<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Actions\Inventory\SetIngredientCostAction;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Http\Requests\Inventory\IngredientUnitRule;
use App\Models\Ingredient;
use App\Support\Ulid;
use App\Support\Units\ResolvedUnit;
use App\Support\Units\UnitConversion;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/ingredients/{ingredient}/cost (Ingredients, Recipes & Purchasing → D1;
 * permission `inventory.adjust`; idempotent by `ulid`): `{ ulid, cost_cents, unit, reason? }`.
 *
 * - `cost_cents`: an integer, 1–100,000,000, the price of **one** `unit`. When
 *   round_half_up(cost_cents / factor(unit), 6) is 0: `The cost is too small for this unit.`
 * - `unit`: valid for the ingredient (§A): otherwise `Add "<unit>" to <name>'s units first.`
 * - `reason`: optional, max 255.
 */
class SetIngredientCostRequest extends FormRequest
{
    use IngredientUnitRule;
    use ValidatesIdempotencyKey;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('setCost', $this->ingredient()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'cost_cents' => ['required', 'bail', 'integer', 'min:1', 'max:100000000', $this->notTooSmall(...)],
            'unit' => ['required', 'string', 'max:20', $this->ingredientUnit($this->ingredient())],
            'reason' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    /**
     * The average cost per base unit must not round to 0 (checked once the unit is valid).
     */
    private function notTooSmall(string $attribute, mixed $value, Closure $fail): void
    {
        $unit = $this->input('unit');
        $resolved = is_string($unit) ? UnitConversion::forIngredient($this->ingredient(), $unit) : null;

        if ($resolved !== null && SetIngredientCostAction::averageFor((int) $value, $resolved->factor)->isZero()) {
            $fail(SetIngredientCostAction::MESSAGE_TOO_SMALL);
        }
    }

    public function ingredient(): Ingredient
    {
        /** @var Ingredient */
        return $this->route('ingredient');
    }

    public function costCents(): int
    {
        return (int) $this->validated('cost_cents');
    }

    public function unit(): ResolvedUnit
    {
        /** @var ResolvedUnit */
        return UnitConversion::forIngredient($this->ingredient(), (string) $this->validated('unit'));
    }

    public function reason(): ?string
    {
        $reason = $this->validated('reason');

        return is_string($reason) ? $reason : null;
    }
}
