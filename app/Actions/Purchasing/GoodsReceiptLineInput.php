<?php

namespace App\Actions\Purchasing;

/**
 * A validated receipt line: its index in the body (for the 422 key), the PO line, the quantity
 * received (negative for a correction) and the correction's reason.
 */
final readonly class GoodsReceiptLineInput
{
    public function __construct(
        public int $index,
        public int $purchaseOrderLineId,
        public ResolvedQuantity $quantity,
        public ?string $reason,
    ) {}
}
