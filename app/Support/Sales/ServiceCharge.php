<?php

namespace App\Support\Sales;

use App\Support\Money;
use InvalidArgumentException;

/**
 * The service charge and the equal split of a tab settlement (Dine-in Tables & Tabs → E;
 * the app runs the same math in `@pos/core/sale`).
 *
 * - `S = rhu(T × service_charge_bps, 10000)`, where `T` is the order total after every
 *   discount (Core Sale step 7, after SC/PWD). `total_cents = T + S`. `S` is not discounted
 *   and is outside the VAT figures.
 * - Equal split into `N` shares: share `k` (1-based) = `floor(total / N)`, plus 1 centavo
 *   for `k ≤ total mod N`.
 *
 * Worked example K: `T = 25700` at 1000 bps → `S = 2570`, total 28270; split 3 →
 * 9424 · 9423 · 9423.
 */
final class ServiceCharge
{
    public const BPS_DENOMINATOR = 10000;

    public static function amount(int $totalCents, int $bps): int
    {
        if ($totalCents < 0 || $bps < 0) {
            throw new InvalidArgumentException('The total and the rate must not be negative.');
        }

        return $bps === 0 ? 0 : Money::roundHalfUp($totalCents * $bps, self::BPS_DENOMINATOR);
    }

    /**
     * @return list<int> The `N` shares, in share order; they add up to `$totalCents`
     */
    public static function shares(int $totalCents, int $count): array
    {
        if ($totalCents < 0 || $count < 1) {
            throw new InvalidArgumentException('The total must not be negative and the share count must be positive.');
        }

        $base = intdiv($totalCents, $count);
        $extra = $totalCents % $count;

        $shares = [];

        for ($k = 1; $k <= $count; $k++) {
            $shares[] = $base + ($k <= $extra ? 1 : 0);
        }

        return $shares;
    }
}
