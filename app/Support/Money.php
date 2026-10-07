<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * Integer-centavo helpers. Money is never a float (PROJECT_MEMORY §4.1).
 */
final class Money
{
    /**
     * Round half up: `floor((n + floor(d / 2)) / d)`, for `n ≥ 0` and `d > 0`
     * (the contract's `rhu(n, d)`).
     */
    public static function roundHalfUp(int $numerator, int $denominator): int
    {
        if ($numerator < 0 || $denominator <= 0) {
            throw new InvalidArgumentException('roundHalfUp needs n >= 0 and d > 0.');
        }

        return intdiv($numerator + intdiv($denominator, 2), $denominator);
    }

    /**
     * Pesos for people: 125050 → "₱1,250.50", 800 → "₱8.00". Integer arithmetic only.
     */
    public static function format(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);

        $pesos = (string) intdiv($cents, 100);
        $grouped = strrev(implode(',', str_split(strrev($pesos), 3)));

        return sprintf('%s₱%s.%02d', $sign, $grouped, $cents % 100);
    }

    /**
     * Pesos for spreadsheets (the CSV export, Phase 6): 125050 → "1250.50", 5 → "0.05",
     * −800 → "-8.00". No symbol, no grouping. Integer arithmetic only.
     */
    public static function decimal(int $cents): string
    {
        $sign = $cents < 0 ? '-' : '';
        $cents = abs($cents);

        return sprintf('%s%d.%02d', $sign, intdiv($cents, 100), $cents % 100);
    }
}
