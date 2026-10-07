<?php

namespace App\Support;

use Brick\Math\BigDecimal;

/**
 * The derived stock status of a `track_stock` product in a branch (Inventory, v1 completion;
 * PROJECT_MEMORY §4.5). It is never stored. A missing level counts as qty 0 with no reorder
 * level:
 *
 * - `out` when qty ≤ 0;
 * - `low` when the reorder level is not null and qty ≤ reorder level;
 * - `in_stock` otherwise.
 *
 * The list and report filter `alerts` means `low` or `out`.
 */
final class StockStatus
{
    public const IN_STOCK = 'in_stock';

    public const LOW = 'low';

    public const OUT = 'out';

    public const ALERTS = 'alerts';

    /**
     * The values of the `status` query filter.
     */
    public const FILTERS = [self::IN_STOCK, self::LOW, self::OUT, self::ALERTS];

    public static function of(int $qty, ?int $reorderLevel): string
    {
        if ($qty <= 0) {
            return self::OUT;
        }

        return $reorderLevel !== null && $qty <= $reorderLevel ? self::LOW : self::IN_STOCK;
    }

    /**
     * The same rule for an ingredient (Ingredients, Recipes & Purchasing → B): exact decimal
     * quantities in the base unit (3 decimals).
     */
    public static function ofDecimal(string $qty, ?string $reorderLevel): string
    {
        $qty = BigDecimal::of($qty);

        if ($qty->isNegativeOrZero()) {
            return self::OUT;
        }

        return $reorderLevel !== null && $qty->isLessThanOrEqualTo($reorderLevel) ? self::LOW : self::IN_STOCK;
    }

    /**
     * The same rule as a SQL CASE expression over the given column expressions (the level's
     * qty, possibly NULL for a missing level, and its reorder level).
     */
    public static function sql(string $qty, string $reorderLevel): string
    {
        return "CASE WHEN COALESCE({$qty}, 0) <= 0 THEN '".self::OUT."'"
            ." WHEN {$reorderLevel} IS NOT NULL AND COALESCE({$qty}, 0) <= {$reorderLevel} THEN '".self::LOW."'"
            ." ELSE '".self::IN_STOCK."' END";
    }

    /**
     * The statuses a `status` filter selects.
     *
     * @return list<string>
     */
    public static function matching(string $filter): array
    {
        return $filter === self::ALERTS ? [self::LOW, self::OUT] : [$filter];
    }
}
