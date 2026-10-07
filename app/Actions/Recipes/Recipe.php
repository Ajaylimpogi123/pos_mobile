<?php

namespace App\Actions\Recipes;

/**
 * A product's recipe with its cost per serving (BuildRecipe), rendered by RecipeResource.
 */
final readonly class Recipe
{
    /**
     * @param  list<array{component: array{type: string, id: int, name: string, base_unit: string}, qty: string|int, unit: string, base_qty: string|int, unit_cost: string, line_cost_cents: int}>  $lines
     */
    public function __construct(
        public array $lines,
        public int $costCents,
        public int $priceCents,
        public ?int $marginBps,
    ) {}
}
