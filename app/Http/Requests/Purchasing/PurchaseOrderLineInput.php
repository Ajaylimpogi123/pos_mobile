<?php

namespace App\Http\Requests\Purchasing;

use App\Actions\Purchasing\PurchaseItemResolver;
use App\Actions\Purchasing\ResolvedQuantity;
use App\Models\Ingredient;
use App\Models\Product;
use App\Models\PurchaseOrderLine;
use App\Support\Quantity;
use Illuminate\Support\Str;

/**
 * Resolves a quantity entered against a PO line (an edit of the line, or a receipt): the unit is
 * the line's own unit (its name and factor snapshot) when it matches, else a unit valid for the
 * line's item.
 */
trait PurchaseOrderLineInput
{
    /**
     * @return ResolvedQuantity|array{0: 'qty'|'unit', 1: string}
     */
    protected function lineQuantity(PurchaseItemResolver $resolver, PurchaseOrderLine $line, string $qty, string $unit): ResolvedQuantity|array
    {
        /** @var Ingredient|Product $item */
        $item = $line->isIngredient() ? $line->ingredient()->with('units')->first() : $line->product;

        $own = Str::lower(trim($unit)) === Str::lower($line->unit)
            ? PurchaseItemResolver::lineUnit($line->unit, (string) $line->unit_factor)
            : null;

        return $resolver->quantity($item, (string) Quantity::parseInput($qty), $unit, $own);
    }
}
