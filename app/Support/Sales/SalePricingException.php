<?php

namespace App\Support\Sales;

use RuntimeException;

/**
 * A sale that cannot be priced. Carries every pricing problem found, so the caller can
 * report them all at once (CompleteSaleAction turns them into a 422).
 */
final class SalePricingException extends RuntimeException
{
    /**
     * @param  array<int, int>  $lineDiscountBases  Line index => the line's base (`gross_cents`),
     *                                              for each line discount above its base
     * @param  int|null  $orderDiscountBase  The base `B`, when the order discount is above it
     * @param  bool  $tooLarge  `subtotal_cents` is above {@see SaleCalculator::MAX_SUBTOTAL_CENTS}
     */
    public function __construct(
        public readonly array $lineDiscountBases,
        public readonly ?int $orderDiscountBase,
        public readonly bool $tooLarge,
    ) {
        parent::__construct('The sale cannot be priced.');
    }
}
