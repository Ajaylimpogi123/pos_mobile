<?php

namespace App\Support\Sales;

/**
 * The server-computed totals of a sale (Phase 3 contract, *Sale pricing*, extended by the
 * SC/PWD contract).
 *
 * `discountCents = lineDiscountsCents + orderDiscountCents + scPwdVatReliefCents (R) +
 * scPwdDiscountCents (S)` and `totalCents = subtotalCents − discountCents = Σ lines'
 * lineTotalCents`. The regular (discretionary) discounts are regularDiscountCents().
 */
final class PricedSale
{
    /**
     * @param  list<PricedLine>  $lines  In the order given
     */
    public function __construct(
        public readonly array $lines,
        public readonly ?Discount $orderDiscount,
        public readonly int $subtotalCents,
        public readonly int $lineDiscountsCents,
        public readonly int $orderDiscountCents,
        public readonly int $discountCents,
        public readonly int $totalCents,
        public readonly int $vatableSalesCents,
        public readonly int $vatAmountCents,
        public readonly int $vatExemptSalesCents,
        public readonly ?ScPwd $scPwd = null,
        public readonly int $scPwdVatReliefCents = 0,
        public readonly int $scPwdDiscountCents = 0,
    ) {}

    /**
     * The regular discounts only (`line_discounts_cents + D`): what the discount approval
     * and the offline `discount_over_limit` flag compare with the subtotal. SC/PWD is never
     * part of it.
     */
    public function regularDiscountCents(): int
    {
        return $this->lineDiscountsCents + $this->orderDiscountCents;
    }
}
