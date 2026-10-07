<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Models\Ingredient;
use App\Support\Units\UnitConversion;
use Brick\Math\BigDecimal;
use Closure;
use Illuminate\Validation\Rule;

/**
 * The `Ingredient` fields (Ingredients, Recipes & Purchasing → A, D):
 *
 * - `name`: required, max 120, unique among non-deleted ingredients (case-insensitively);
 * - `base_unit`: `in:g,mL,pc` (immutable once in use: a 409 from the action);
 * - `is_active`;
 * - `units`: `[{id?, name, factor}]`, replaced as a set (at most 50). `name`: max 20, unique in
 *   the set case-insensitively, and not a catalog code of the ingredient's own dimension
 *   (`"kg" is already a standard unit.`); `factor`: a decimal > 0, at most 1,000,000, with up to
 *   10 decimals. An `id` must be one of this ingredient's units.
 */
trait IngredientRules
{
    public const MAX_UNITS = 50;

    public const FACTOR_PATTERN = '/^\d{1,7}(\.\d{1,10})?$/D';

    public const MESSAGE_FACTOR_FORMAT = 'The :attribute field must be a number with at most 10 decimals.';

    public const MESSAGE_FACTOR_POSITIVE = 'The :attribute field must be greater than 0.';

    public const MESSAGE_FACTOR_MAX = 'The :attribute field must not be greater than 1000000.';

    /**
     * @return array<string, list<mixed>>
     */
    protected function ingredientRules(bool $partial, ?Ingredient $ingredient = null): array
    {
        $sometimes = $partial ? ['sometimes'] : [];

        return [
            'name' => [
                ...$sometimes, 'required', 'string', 'max:120',
                Rule::unique('ingredients', 'name')->whereNull('deleted_at')->ignore($ingredient?->id),
            ],
            'base_unit' => [...$sometimes, 'required', 'string', Rule::in(array_keys(Ingredient::BASE_UNITS))],
            'is_active' => ['sometimes', 'required', 'boolean'],
            'units' => ['sometimes', 'array', 'max:'.self::MAX_UNITS],
            'units.*' => ['array:id,name,factor'],
            'units.*.id' => $ingredient === null
                ? ['prohibited']
                : ['sometimes', 'nullable', 'integer', 'distinct', Rule::exists('ingredient_units', 'id')->where('ingredient_id', $ingredient->id)],
            'units.*.name' => ['required', 'string', 'max:20', 'distinct:ignore_case', $this->notReserved($ingredient)],
            'units.*.factor' => ['required', $this->factor(...)],
        ];
    }

    /**
     * An own unit may not reuse a catalog code of the ingredient's own dimension (the base unit
     * sent, else the current one).
     */
    private function notReserved(?Ingredient $ingredient): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($ingredient): void {
            $baseUnit = $this->input('base_unit', $ingredient?->base_unit);

            if (is_string($value) && is_string($baseUnit) && UnitConversion::isReserved($baseUnit, $value)) {
                $fail(UnitConversion::reservedMessage($value));
            }
        };
    }

    private function factor(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_int($value)) {
            $value = (string) $value;
        } elseif (is_float($value)) {
            $value = is_finite($value) ? (string) BigDecimal::fromFloatShortest($value) : '';
        }

        if (! is_string($value) || preg_match(self::FACTOR_PATTERN, $value) !== 1) {
            $fail(self::MESSAGE_FACTOR_FORMAT);

            return;
        }

        $factor = BigDecimal::of($value);

        if ($factor->isZero()) {
            $fail(self::MESSAGE_FACTOR_POSITIVE);
        } elseif ($factor->isGreaterThan(1000000)) {
            $fail(self::MESSAGE_FACTOR_MAX);
        }
    }

    /**
     * The validated units set, or null when `units` wasn't sent: `[{id, name, factor}]` with
     * `factor` as an exact decimal string.
     *
     * @return list<array{id: int|null, name: string, factor: string}>|null
     */
    public function units(): ?array
    {
        if (! array_key_exists('units', $this->validated())) {
            return null;
        }

        return array_values(array_map(function (array $unit): array {
            $factor = $unit['factor'];

            return [
                'id' => isset($unit['id']) ? (int) $unit['id'] : null,
                'name' => trim((string) $unit['name']),
                'factor' => is_float($factor) ? (string) BigDecimal::fromFloatShortest($factor) : (string) $factor,
            ];
        }, (array) $this->validated('units')));
    }

    /**
     * The ingredient's own fields (no `units`).
     *
     * @return array<string, mixed>
     */
    public function ingredientAttributes(): array
    {
        return array_intersect_key($this->validated(), array_flip(['name', 'base_unit', 'is_active']));
    }
}
