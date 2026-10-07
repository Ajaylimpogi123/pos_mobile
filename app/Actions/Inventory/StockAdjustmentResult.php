<?php

namespace App\Actions\Inventory;

use App\Models\StockMovement;

/**
 * A recorded stock adjustment: its `adjustment` movement and the quantity on hand
 * before and after it (in whole units).
 */
final readonly class StockAdjustmentResult
{
    public function __construct(
        public StockMovement $movement,
        public int $qtyBefore,
        public int $qtyAfter,
    ) {}
}
