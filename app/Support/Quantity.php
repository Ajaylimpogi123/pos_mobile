<?php

namespace App\Support;

use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\RoundingMode;

/**
 * Exact decimal quantities and rates (Ingredients, Recipes & Purchasing → A, B). Never floats:
 * every value is a brick/math BigDecimal, built from strings.
 *
 * - Quantities (stock, ledger, PR/PO/receipt lines) have 3 decimals and are sent as strings
 *   with exactly 3 decimals (`"25000.000"`).
 * - `avg_cost` (centavos per base unit) has 6 decimals.
 * - `round_half_up` is symmetric: a negative value rounds like its absolute value (so a
 *   correction of −1 tbsp mirrors +1 tbsp).
 */
final class Quantity
{
    public const SCALE = 3;

    public const COST_SCALE = 6;

    /**
     * A request quantity: an optional minus, digits, and at most 3 decimals (no exponent, no
     * leading `+`, no bare `.`).
     */
    public const INPUT_PATTERN = '/^-?\d{1,9}(\.\d{1,3})?$/D';

    public static function of(BigNumber|string|int $value): BigDecimal
    {
        return BigDecimal::of($value);
    }

    /**
     * A request value (JSON string or number) as a decimal string, or null when it isn't a
     * number with at most 3 decimals.
     */
    public static function parseInput(mixed $value): ?string
    {
        if (is_int($value)) {
            $value = (string) $value;
        } elseif (is_float($value)) {
            // JSON numbers such as 1.5: their shortest decimal representation.
            $value = is_finite($value) ? (string) BigDecimal::fromFloatShortest($value) : '';
        }

        if (! is_string($value) || preg_match(self::INPUT_PATTERN, $value) !== 1) {
            return null;
        }

        return (string) BigDecimal::of($value)->toScale(self::SCALE);
    }

    /**
     * round_half_up(value, scale), symmetric around zero.
     */
    public static function round(BigNumber|string|int $value, int $scale = self::SCALE): BigDecimal
    {
        $decimal = BigDecimal::of($value);
        $rounded = $decimal->abs()->toScale($scale, RoundingMode::HalfUp);

        return $decimal->isNegative() ? $rounded->negated() : $rounded;
    }

    /**
     * round_half_up(value, 0) as an integer (centavos).
     */
    public static function roundToInt(BigNumber|string|int $value): int
    {
        return self::round($value, 0)->toInt();
    }

    /**
     * A quantity as the API sends it: a string with exactly 3 decimals.
     */
    public static function format(BigNumber|string|int $value): string
    {
        return (string) self::round($value, self::SCALE);
    }

    /**
     * A cost rate as the API sends it: a string with exactly 6 decimals.
     */
    public static function formatCost(BigNumber|string|int $value): string
    {
        return (string) self::round($value, self::COST_SCALE);
    }

    /**
     * An exact factor without trailing zeros: `"25000"`, `"0.5"`, `"28.349523125"`.
     */
    public static function normalize(BigNumber|string|int $value): string
    {
        return (string) BigDecimal::of($value)->strippedOfTrailingZeros();
    }

    /**
     * Whether the value has no fractional part (product quantities are whole units).
     */
    public static function isWhole(BigNumber|string|int $value): bool
    {
        $decimal = BigDecimal::of($value);

        return $decimal->isEqualTo($decimal->toScale(0, RoundingMode::Down));
    }

    public static function max(BigDecimal $a, BigDecimal $b): BigDecimal
    {
        return $a->isGreaterThan($b) ? $a : $b;
    }
}
