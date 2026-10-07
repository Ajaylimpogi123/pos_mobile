<?php

namespace App\Support\Sales;

use App\Support\Money;
use InvalidArgumentException;
use LogicException;

/**
 * The authoritative sale pricing of the Phase 3 contract (*Sale pricing*), extended by the
 * SC/PWD contract (steps A–E). Pure: no database, no HTTP. The app runs the same algorithm
 * (with BigInt) for display and for the `client_total_cents` checksum, so both sides must
 * agree to the centavo.
 *
 * 1. `gross = unit_price × qty` (VAT-inclusive).
 * 2. Line discount: percent → `rhu(gross × value, 10000)`, amount → `value`; `≤ gross`.
 * 3. `net = gross − line discount`; the order discount base `B = Σ net`.
 * 4. Order discount `D`: percent → `rhu(B × value, 10000)`, amount → `value`; `≤ B`.
 * 5. `D` is allocated to the lines pro rata to `net` by the largest remainder
 *    ({@see self::allocate()}).
 * 6. `line_total = net − share`; `total = subtotal − discount = Σ line_total`.
 * 7. `subtotal ≤ 1000000000` (₱10,000,000).
 *
 * SC/PWD (only with an ScPwd; then `D = 0` and eligible lines carry no line discount):
 *
 * A. Eligible gross `E_i`: `items` mode → `gross_i` of the marked lines, else 0.
 *    `headcount` mode → `E_total = rhu(subtotal × persons, diners)`, allocated pro rata to
 *    `gross_i` by the largest remainder.
 * B. VAT relief (only when `vat_exempt`): `EV` / `EX` = Σ `E_i` of the VAT-able / other
 *    lines; `base = rhu(EV × 10000, 10000 + r)`, `R = EV − base`, allocated to the VAT-able
 *    lines pro rata to `E_i`. Without it: `base = EV`, `R = 0`.
 * C. `S = rhu((base + EX) × s, 10000)`, allocated pro rata to `E_i − R_i`.
 * D. `line_total_i = net_i − share_i − R_i − S_i`; `discount = line discounts + D + R + S`.
 *
 * E. VAT, rounded **once per order** (reduces to the Phase 3 step 8 without SC/PWD): the
 *    line's exempt part `X_i = E_i − R_i − S_i` when `vat_exempt` (else 0); the taxable
 *    `T = Σ` over VAT-able lines of `line_total_i − X_i`;
 *    `vatable_sales = rhu(T × 10000, 10000 + r)`, `vat = T − vatable_sales`,
 *    `vat_exempt = total − T`.
 *
 * Integer range: product prices are at most ₱1,000,000 (10^8), qty at most 999 and
 * lines at most 100, so every product computed before the size check stays below
 * 10^18. The allocations (up to `10^9 × 10^9`) only run once the size check passed.
 */
final class SaleCalculator
{
    public const MAX_SUBTOTAL_CENTS = 1000000000;

    private const BPS = 10000;

    public function __construct(
        private readonly int $vatRateBps,
        private readonly int $scPwdRateBps = 2000,
    ) {
        if ($vatRateBps < 0) {
            throw new InvalidArgumentException('The VAT rate cannot be negative.');
        }

        if ($scPwdRateBps < 0 || $scPwdRateBps > self::BPS) {
            throw new InvalidArgumentException('The SC/PWD rate must be between 0 and 10000 basis points.');
        }
    }

    /**
     * The calculator with the configured VAT rate (`pos.vat_rate_bps`) and SC/PWD rate
     * (`pos.sc_pwd_discount_bps`).
     */
    public static function fromConfig(): self
    {
        return new self(
            (int) config('pos.vat_rate_bps', 1200),
            (int) config('pos.sc_pwd_discount_bps', 2000),
        );
    }

    /**
     * @param  list<SaleLine>  $lines
     *
     * @throws SalePricingException with every discount above its base, and the size limit
     * @throws InvalidArgumentException when SC/PWD is combined with another discount, or a
     *                                  line is marked without SC/PWD (the request validation
     *                                  rejects both first)
     */
    public function price(array $lines, ?Discount $orderDiscount = null, ?ScPwd $scPwd = null): PricedSale
    {
        $lines = array_values($lines);

        self::assertNoDoubleDiscount($lines, $orderDiscount, $scPwd);

        $gross = [];
        $lineDiscounts = [];
        $lineDiscountBases = [];

        foreach ($lines as $i => $line) {
            $gross[$i] = $line->unitPriceCents * $line->qty;
            $lineDiscounts[$i] = $line->discount?->amountOn($gross[$i]) ?? 0;

            if ($lineDiscounts[$i] > $gross[$i]) {
                $lineDiscountBases[$i] = $gross[$i];
            }
        }

        $subtotal = array_sum($gross);

        // B is only meaningful when every line discount fits its line.
        $nets = [];
        $orderDiscountCents = 0;
        $orderDiscountBase = null;

        if ($lineDiscountBases === []) {
            foreach ($gross as $i => $amount) {
                $nets[$i] = $amount - $lineDiscounts[$i];
            }

            $base = array_sum($nets);
            $orderDiscountCents = $orderDiscount?->amountOn($base) ?? 0;

            if ($orderDiscountCents > $base) {
                $orderDiscountBase = $base;
            }
        }

        $tooLarge = $subtotal > self::MAX_SUBTOTAL_CENTS;

        if ($lineDiscountBases !== [] || $orderDiscountBase !== null || $tooLarge) {
            throw new SalePricingException($lineDiscountBases, $orderDiscountBase, $tooLarge);
        }

        $shares = self::allocate($orderDiscountCents, $nets);

        // SC/PWD steps A–C (all 0 without it).
        $eligible = $this->eligible($lines, $gross, $subtotal, $scPwd);
        [$reliefs, $reliefTotal, $reliefBase] = $this->vatRelief($lines, $eligible, $scPwd);
        $eligibleNotVatable = 0;

        foreach ($lines as $i => $line) {
            $eligibleNotVatable += $line->isVatable ? 0 : $eligible[$i];
        }

        $scPwdDiscount = $scPwd === null
            ? 0
            : Money::roundHalfUp(($reliefBase + $eligibleNotVatable) * $this->scPwdRateBps, self::BPS);
        $scPwdShares = self::allocate($scPwdDiscount, array_map(
            fn (int $e, int $r) => $e - $r,
            $eligible,
            $reliefs,
        ));

        // Steps D and E.
        $priced = [];
        $taxable = 0;
        $total = 0;

        foreach ($lines as $i => $line) {
            $lineTotal = $nets[$i] - $shares[$i] - $reliefs[$i] - $scPwdShares[$i];
            $exempt = $scPwd?->vatExempt ? $eligible[$i] - $reliefs[$i] - $scPwdShares[$i] : 0;
            $total += $lineTotal;

            if ($line->isVatable) {
                $taxable += $lineTotal - $exempt;
            }

            $priced[] = new PricedLine(
                unitPriceCents: $line->unitPriceCents,
                qty: $line->qty,
                isVatable: $line->isVatable,
                discount: $line->discount,
                grossCents: $gross[$i],
                lineDiscountCents: $lineDiscounts[$i],
                netCents: $nets[$i],
                orderDiscountShareCents: $shares[$i],
                lineTotalCents: $lineTotal,
                scPwd: $line->scPwd || $eligible[$i] > 0,
                scPwdEligibleCents: $eligible[$i],
                scPwdVatReliefCents: $reliefs[$i],
                scPwdDiscountCents: $scPwdShares[$i],
                scPwdExemptCents: $exempt,
            );
        }

        $lineDiscountsTotal = array_sum($lineDiscounts);
        $discount = $lineDiscountsTotal + $orderDiscountCents + $reliefTotal + $scPwdDiscount;

        if ($total !== $subtotal - $discount) {
            throw new LogicException('The line totals do not add up to the order total.');
        }

        $vatableSales = Money::roundHalfUp($taxable * self::BPS, self::BPS + $this->vatRateBps);

        return new PricedSale(
            lines: $priced,
            orderDiscount: $orderDiscount,
            subtotalCents: $subtotal,
            lineDiscountsCents: $lineDiscountsTotal,
            orderDiscountCents: $orderDiscountCents,
            discountCents: $discount,
            totalCents: $total,
            vatableSalesCents: $vatableSales,
            vatAmountCents: $taxable - $vatableSales,
            vatExemptSalesCents: $total - $taxable,
            scPwd: $scPwd,
            scPwdVatReliefCents: $reliefTotal,
            scPwdDiscountCents: $scPwdDiscount,
        );
    }

    /**
     * Allocates `$amount` (≤ Σ weights) pro rata to the weights by the largest remainder:
     * `floor_i = floor(amount × w_i / W)`, `rem_i = (amount × w_i) mod W`; the leftover
     * `amount − Σ floor_i` centavos go one each to the largest `rem_i`, ties to the lower
     * index. When `W = 0` every share is 0. Keys are preserved.
     *
     * @param  array<int, int>  $weights  Non-negative
     * @return array<int, int>
     */
    public static function allocate(int $amount, array $weights): array
    {
        $total = array_sum($weights);

        if ($total === 0 || $amount === 0) {
            return array_map(fn () => 0, $weights);
        }

        if ($amount < 0 || $amount > $total) {
            throw new InvalidArgumentException('The amount to allocate must be between 0 and the sum of the weights.');
        }

        $shares = [];
        $remainders = [];

        foreach ($weights as $i => $weight) {
            $shares[$i] = intdiv($amount * $weight, $total);
            $remainders[$i] = ($amount * $weight) % $total;
        }

        $leftover = $amount - array_sum($shares);

        $indexes = array_keys($weights);
        usort($indexes, fn (int $a, int $b) => [$remainders[$b], $a] <=> [$remainders[$a], $b]);

        foreach (array_slice($indexes, 0, $leftover) as $i) {
            $shares[$i]++;
        }

        return $shares;
    }

    /**
     * Step A: the eligible gross `E_i` of each line (all 0 without SC/PWD).
     *
     * @param  list<SaleLine>  $lines
     * @param  array<int, int>  $gross
     * @return array<int, int>
     */
    private function eligible(array $lines, array $gross, int $subtotal, ?ScPwd $scPwd): array
    {
        if ($scPwd === null) {
            return array_map(fn () => 0, $gross);
        }

        if ($scPwd->isHeadcount()) {
            $eligibleTotal = Money::roundHalfUp($subtotal * $scPwd->personsCount(), (int) $scPwd->diners);

            return self::allocate($eligibleTotal, $gross);
        }

        $eligible = [];

        foreach ($lines as $i => $line) {
            $eligible[$i] = $line->scPwd ? $gross[$i] : 0;
        }

        return $eligible;
    }

    /**
     * Step B: each line's VAT relief `R_i`, `R`, and the eligible VAT-able base the 20%
     * applies to (`base`). Without `vat_exempt`: every `R_i = 0` and `base = EV`.
     *
     * @param  list<SaleLine>  $lines
     * @param  array<int, int>  $eligible
     * @return array{0: array<int, int>, 1: int, 2: int}
     */
    private function vatRelief(array $lines, array $eligible, ?ScPwd $scPwd): array
    {
        $vatableEligible = [];

        foreach ($lines as $i => $line) {
            $vatableEligible[$i] = $line->isVatable ? $eligible[$i] : 0;
        }

        $eligibleVatable = array_sum($vatableEligible);

        if ($scPwd === null || ! $scPwd->vatExempt) {
            return [array_map(fn () => 0, $eligible), 0, $eligibleVatable];
        }

        $base = Money::roundHalfUp($eligibleVatable * self::BPS, self::BPS + $this->vatRateBps);
        $relief = $eligibleVatable - $base;

        return [self::allocate($relief, $vatableEligible), $relief, $base];
    }

    /**
     * SC/PWD is never combined with another discount (the request validation reports it
     * first, with the contract's messages): no order discount, no line discount on a marked
     * line, no line discount at all in `headcount` mode, and no marked line without SC/PWD
     * or in `headcount` mode.
     *
     * @param  list<SaleLine>  $lines
     */
    private static function assertNoDoubleDiscount(array $lines, ?Discount $orderDiscount, ?ScPwd $scPwd): void
    {
        foreach ($lines as $line) {
            if ($line->scPwd && ($scPwd === null || $scPwd->isHeadcount())) {
                throw new InvalidArgumentException('Only the SC/PWD items mode marks lines.');
            }

            if ($scPwd !== null && $line->discount !== null && ($line->scPwd || $scPwd->isHeadcount())) {
                throw new InvalidArgumentException('SC/PWD cannot be combined with a line discount.');
            }
        }

        if ($scPwd !== null && $orderDiscount !== null) {
            throw new InvalidArgumentException('SC/PWD cannot be combined with an order discount.');
        }
    }
}
