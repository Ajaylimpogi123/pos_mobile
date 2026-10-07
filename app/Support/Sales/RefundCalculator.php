<?php

namespace App\Support\Sales;

use App\Support\Money;
use InvalidArgumentException;

/**
 * The authoritative refund amounts of the Phase 7 contract (*Refund amounts*). Pure: no
 * database, no HTTP. The app runs the same formula (with BigInt).
 *
 * For a line with `qty = n` and `line_total_cents = T`, of which `p` units were already
 * refunded, refunding `k` more units gives
 * `amount = rhu(T × (p + k), n) − rhu(T × p, n)`. The rounding is cumulative, so refunding a
 * line in several parts always adds up to exactly `T`, and a full refund returns exactly the
 * order's `total_cents`.
 *
 * The VAT split is rounded once per refund, as in *Sale pricing* step 8:
 * `V = Σ` the amounts of VAT-able lines, `vatable_sales = rhu(V × 10000, 10000 + rate)`,
 * `vat = V − vatable_sales`, `vat_exempt = Σ` the amounts of the other lines.
 *
 * Integer range: `T ≤ 10^9` and `p + k ≤ n ≤ 999`, so `T × (p + k)` stays below 10^12.
 */
final class RefundCalculator
{
    private const BPS = 10000;

    public function __construct(private readonly int $vatRateBps)
    {
        if ($vatRateBps < 0) {
            throw new InvalidArgumentException('The VAT rate cannot be negative.');
        }
    }

    /**
     * The calculator with the configured VAT rate (`pos.vat_rate_bps`), as SaleCalculator.
     */
    public static function fromConfig(): self
    {
        return new self((int) config('pos.vat_rate_bps', 1200));
    }

    /**
     * The amount of refunding `$refundQty` more units of a line.
     *
     * @param  int  $lineTotalCents  `T`
     * @param  int  $qty  `n`, the line's quantity sold
     * @param  int  $refundedQty  `p`, the units already refunded
     * @param  int  $refundQty  `k`, the units refunded now
     */
    public static function lineAmount(int $lineTotalCents, int $qty, int $refundedQty, int $refundQty): int
    {
        if ($qty <= 0 || $refundedQty < 0 || $refundQty < 0 || $refundedQty + $refundQty > $qty || $lineTotalCents < 0) {
            throw new InvalidArgumentException('A refund needs 0 ≤ p, 0 ≤ k, p + k ≤ n, n > 0 and T ≥ 0.');
        }

        return Money::roundHalfUp($lineTotalCents * ($refundedQty + $refundQty), $qty)
            - Money::roundHalfUp($lineTotalCents * $refundedQty, $qty);
    }

    /**
     * The VAT-able part of refunding `$refundQty` more units of a VAT-able line (SC/PWD
     * contract, *Refunds*): the same cumulative formula on the line's taxable part
     * `τ = line_total − X`, i.e. `rhu(τ × (p + k), n) − rhu(τ × p, n)`. The rest of the
     * line's refund amount is VAT-exempt. Without SC/PWD, `τ = T` and this is the amount.
     *
     * The result is kept within `0..amount` (Q-024): when `0 < X < n`, the
     * cumulative rounding of `τ` can run one centavo ahead of the amount's for a partial
     * refund, which would make its VAT-exempt part −1.
     *
     * @param  int  $amountCents  The line's refund amount (lineAmount())
     * @param  int  $taxableCents  `τ`
     */
    public static function taxableAmount(int $amountCents, int $taxableCents, int $qty, int $refundedQty, int $refundQty): int
    {
        $taxable = self::lineAmount($taxableCents, $qty, $refundedQty, $refundQty);

        return max(0, min($amountCents, $taxable));
    }

    /**
     * The VAT split of a refund, from the Σ of its VAT-able and its other line amounts.
     *
     * @return array{vatable_sales_cents: int, vat_amount_cents: int, vat_exempt_sales_cents: int}
     */
    public function vatSplit(int $vatableAmountCents, int $vatExemptAmountCents): array
    {
        $vatableSales = Money::roundHalfUp($vatableAmountCents * self::BPS, self::BPS + $this->vatRateBps);

        return [
            'vatable_sales_cents' => $vatableSales,
            'vat_amount_cents' => $vatableAmountCents - $vatableSales,
            'vat_exempt_sales_cents' => $vatExemptAmountCents,
        ];
    }
}
