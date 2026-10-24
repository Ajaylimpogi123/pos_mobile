<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Product margin in integer basis points (5500 = 55.00%).
 *
 *     margin_bps = intdiv((price_cents - cost_cents) * 10000, price_cents)
 *
 * - Integer division, **rounding toward zero** (PHP `intdiv`, MySQL `DIV`), so the
 *   PHP and SQL forms always agree: 3500/2800 → 2000, 3000/2001 → 3330.
 * - A product with `price_cents = 0` or `cost_cents = 0` has **no** margin (`null`):
 *   the margin is unknown (no cost entered) or meaningless (free item). Such products
 *   are excluded from every margin figure (averages, low-margin lists and counts).
 * - A cost above the price gives a **negative** margin. It is a real figure, so it is
 *   included in averages and counts as a low margin.
 * - An average of margins is the mean of the qualifying products' `margin_bps`, again
 *   with integer division toward zero (`intdiv(sum, count)`).
 */
final class Margin
{
    /**
     * The margin of one product, or null when it does not qualify.
     */
    public static function bps(int $priceCents, int $costCents): ?int
    {
        if ($priceCents <= 0 || $costCents <= 0) {
            return null;
        }

        return intdiv(($priceCents - $costCents) * 10000, $priceCents);
    }

    /**
     * The mean of a sum of margins over a count of qualifying products, or null when none qualify.
     */
    public static function average(int $sumBps, int $count): ?int
    {
        return $count > 0 ? intdiv($sumBps, $count) : null;
    }

    /**
     * SQL condition: the product has a margin (price and cost both above zero).
     * `$table` is a trusted table name or alias, never user input; it is qualified through
     * the query grammar, so it gets the connection's table prefix.
     */
    public static function qualifiesSql(string $table = 'products'): string
    {
        [$price, $cost] = self::columns($table);

        return "({$price} > 0 AND {$cost} > 0)";
    }

    /**
     * SQL expression for the margin in basis points, identical to bps().
     * The money columns are UNSIGNED, so they are cast to SIGNED before subtracting
     * (a cost above the price would otherwise overflow). MySQL `DIV` truncates toward
     * zero like `intdiv`. Only meaningful where qualifiesSql() holds.
     */
    public static function bpsSql(string $table = 'products'): string
    {
        [$price, $cost] = self::columns($table);

        return "(((CAST({$price} AS SIGNED) - CAST({$cost} AS SIGNED)) * 10000)"
            ." DIV CAST({$price} AS SIGNED))";
    }

    /**
     * The wrapped `price_cents` and `cost_cents` of `$table`.
     *
     * @return array{string, string}
     */
    private static function columns(string $table): array
    {
        $grammar = DB::getQueryGrammar();

        return [$grammar->wrap("{$table}.price_cents"), $grammar->wrap("{$table}.cost_cents")];
    }
}
