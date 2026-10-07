<?php

namespace App\Http\Requests\Inventory;

use App\Models\Ingredient;
use App\Support\Units\UnitConversion;
use Closure;

/**
 * A unit field that must be valid for the ingredient (its own units, then the catalog units of
 * its dimension): otherwise `Add "<unit>" to <name>'s units first.`
 */
trait IngredientUnitRule
{
    protected function ingredientUnit(Ingredient $ingredient): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($ingredient): void {
            if (is_string($value) && UnitConversion::forIngredient($ingredient, $value) === null) {
                $fail(UnitConversion::unknownMessage($value, $ingredient->name));
            }
        };
    }
}
