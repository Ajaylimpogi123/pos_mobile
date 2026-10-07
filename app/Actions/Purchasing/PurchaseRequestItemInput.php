<?php

namespace App\Actions\Purchasing;

use App\Models\Ingredient;
use App\Models\Product;

/**
 * A validated purchase request item from a request body: its `id` (edits only; null for a new
 * item), the item, the supplier, the quantity, the estimated price per entered unit and remarks.
 */
final readonly class PurchaseRequestItemInput
{
    public function __construct(
        public ?int $id,
        public Ingredient|Product $item,
        public int $supplierId,
        public ResolvedQuantity $quantity,
        public ?int $estimatedUnitPriceCents,
        public ?string $remarks,
    ) {}

    /**
     * The item's `ingredient_id` / `product_id` columns.
     *
     * @return array{ingredient_id: int|null, product_id: int|null}
     */
    public function itemColumns(): array
    {
        return [
            'ingredient_id' => $this->item instanceof Ingredient ? $this->item->id : null,
            'product_id' => $this->item instanceof Product ? $this->item->id : null,
        ];
    }
}
