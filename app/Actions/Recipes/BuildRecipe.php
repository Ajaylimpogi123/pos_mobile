<?php

namespace App\Actions\Recipes;

use App\Models\Product;
use App\Models\RecipeLine;
use App\Models\StockLevel;
use App\Support\Margin;
use App\Support\Quantity;
use App\Support\Units\UnitConversion;
use Brick\Math\BigDecimal;

/**
 * The `Recipe` of a product with its cost per serving (Ingredients, Recipes & Purchasing → J), for
 * the caller's branch:
 *
 * - an ingredient line: `unit_cost` = the ingredient's `avg_cost` in the branch (a missing level
 *   is 0), `line_cost_cents = round_half_up(base_qty × avg_cost, 0)`;
 * - an `own` product line: `unit_cost` = the product's `cost_cents` per `pc`,
 *   `line_cost_cents = cost_cents × qty`;
 * - `cost_cents = Σ line_cost_cents`; `price_cents` is the product's; `margin_bps` as everywhere
 *   (App\Support\Margin: null when the price or the cost is 0).
 *
 * The recipe rows are returned whatever the product's stock mode (a `recipe` → other switch
 * keeps them). Two queries: the lines with their components, and the ingredients' levels.
 */
class BuildRecipe
{
    public function execute(Product $product, int $branchId): Recipe
    {
        $lines = RecipeLine::query()
            ->where('product_id', $product->id)
            ->with(['ingredient', 'componentProduct'])
            ->orderBy('id')
            ->get();

        $avgCosts = StockLevel::query()
            ->where('branch_id', $branchId)
            ->whereIn('ingredient_id', $lines->pluck('ingredient_id')->filter()->values()->all())
            ->pluck('avg_cost', 'ingredient_id');

        $costCents = 0;
        $rows = [];

        foreach ($lines as $line) {
            $base = BigDecimal::of((string) $line->base_qty);

            if ($line->ingredient_id !== null) {
                $unitCost = BigDecimal::of((string) ($avgCosts[$line->ingredient_id] ?? '0'));
                $lineCost = Quantity::roundToInt($base->multipliedBy($unitCost));
                $component = [
                    'type' => RecipeLine::COMPONENT_INGREDIENT,
                    'id' => $line->ingredient_id,
                    'name' => $line->ingredient->name,
                    'base_unit' => $line->ingredient->base_unit,
                ];
                $qty = Quantity::format((string) $line->qty);
                $baseQty = Quantity::format($base);
            } else {
                $componentProduct = $line->componentProduct;
                $unitCost = BigDecimal::of($componentProduct->cost_cents);
                $lineCost = $base->multipliedBy($componentProduct->cost_cents)->toScale(0)->toInt();
                $component = [
                    'type' => RecipeLine::COMPONENT_PRODUCT,
                    'id' => $componentProduct->id,
                    'name' => $componentProduct->name,
                    'base_unit' => UnitConversion::PRODUCT_UNIT,
                ];
                // Product quantities stay integers (Q-027).
                $qty = BigDecimal::of((string) $line->qty)->toScale(0)->toInt();
                $baseQty = $base->toScale(0)->toInt();
            }

            $costCents += $lineCost;
            $rows[] = [
                'component' => $component,
                'qty' => $qty,
                'unit' => $line->unit,
                'base_qty' => $baseQty,
                'unit_cost' => Quantity::formatCost($unitCost),
                'line_cost_cents' => $lineCost,
            ];
        }

        return new Recipe(
            lines: $rows,
            costCents: $costCents,
            priceCents: (int) $product->price_cents,
            marginBps: Margin::bps((int) $product->price_cents, $costCents),
        );
    }
}
