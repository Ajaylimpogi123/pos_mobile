<?php

namespace App\Actions\Inventory;

use App\Models\StockMovement;

/**
 * A recorded ingredient stock adjustment: its movement and the quantity on hand before and
 * after it (base units, strings with 3 decimals).
 */
final readonly class IngredientStockAdjustmentResult
{
    public function __construct(
        public StockMovement $movement,
        public string $qtyBefore,
        public string $qtyAfter,
    ) {}
}
