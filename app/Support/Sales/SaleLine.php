<?php

namespace App\Support\Sales;

use InvalidArgumentException;

/**
 * One line to price: the server's current VAT-inclusive unit price, the quantity,
 * whether the product is VAT-able, an optional line discount, and whether the line is
 * marked for the senior citizen or PWD (`items.*.sc_pwd`, SC/PWD `items` mode only).
 */
final class SaleLine
{
    public function __construct(
        public readonly int $unitPriceCents,
        public readonly int $qty,
        public readonly bool $isVatable,
        public readonly ?Discount $discount = null,
        public readonly bool $scPwd = false,
    ) {
        if ($unitPriceCents < 0 || $qty < 1) {
            throw new InvalidArgumentException('A sale line needs a unit price >= 0 and a qty >= 1.');
        }
    }
}
