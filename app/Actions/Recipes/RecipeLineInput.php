<?php

namespace App\Actions\Recipes;

use App\Actions\Purchasing\ResolvedQuantity;
use App\Models\Ingredient;
use App\Models\Product;

/**
 * One validated recipe line (UpdateRecipeRequest): the component and its quantity per serving.
 */
final readonly class RecipeLineInput
{
    public function __construct(
        public Ingredient|Product $component,
        public ResolvedQuantity $quantity,
    ) {}

    public function isIngredient(): bool
    {
        return $this->component instanceof Ingredient;
    }
}
