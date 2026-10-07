<?php

namespace App\Actions\Purchasing;

use App\Support\Units\ResolvedUnit;
use Brick\Math\BigDecimal;

/**
 * A validated purchasing quantity: the entered `qty` (3 decimals), its unit (canonical name and
 * exact factor) and `baseQty` = round_half_up(qty × factor, 3).
 */
final readonly class ResolvedQuantity
{
    public function __construct(
        public string $qty,
        public ResolvedUnit $unit,
        public BigDecimal $baseQty,
    ) {}
}
