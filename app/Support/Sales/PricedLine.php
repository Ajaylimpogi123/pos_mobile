<?php

namespace App\Support\Sales;

/**
 * A priced sale line. `netCents = grossCents − lineDiscountCents` and
 * `lineTotalCents = netCents − orderDiscountShareCents − scPwdVatReliefCents −
 * scPwdDiscountCents`.
 *
 * SC/PWD (all 0 / false without it): `scPwd` = the line is marked, or has an eligible share
 * in `headcount` mode; `scPwdEligibleCents` = `E_i`; `scPwdVatReliefCents` = `R_i`;
 * `scPwdDiscountCents` = `S_i`; `scPwdExemptCents` = `X_i`, the line's VAT-exempt part
 * (`E_i − R_i − S_i` when the sale is VAT exempt, else 0).
 */
final class PricedLine
{
    public function __construct(
        public readonly int $unitPriceCents,
        public readonly int $qty,
        public readonly bool $isVatable,
        public readonly ?Discount $discount,
        public readonly int $grossCents,
        public readonly int $lineDiscountCents,
        public readonly int $netCents,
        public readonly int $orderDiscountShareCents,
        public readonly int $lineTotalCents,
        public readonly bool $scPwd = false,
        public readonly int $scPwdEligibleCents = 0,
        public readonly int $scPwdVatReliefCents = 0,
        public readonly int $scPwdDiscountCents = 0,
        public readonly int $scPwdExemptCents = 0,
    ) {}
}
