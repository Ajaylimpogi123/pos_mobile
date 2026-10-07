<?php

namespace App\Support\Units;

use App\Models\Ingredient;
use App\Models\IngredientUnit;
use App\Models\Unit;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Brick\Math\BigNumber;
use Brick\Math\RoundingMode;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Units and exact conversions (Ingredients, Recipes & Purchasing → A). The server is the
 * authority; the app mirrors this with BigInt for previews.
 *
 * **Valid units of an item**
 * - An ingredient: its own units, then the catalog units of its base unit's dimension. An own
 *   unit that reuses a catalog code takes precedence (a density: `cup` = 120 g of flour).
 * - A product (an `own`-stock product; until Round B a `track_stock` one): `pc` only (factor 1).
 * - Anything else: `Add "<unit>" to <name>'s units first.` (422 on the unit field).
 *
 * Units are matched case-insensitively and answered with their canonical spelling (`ml` → `mL`);
 * the catalog codes are distinct when lowercased.
 *
 * **Own units** may not reuse a catalog code of the ingredient's own dimension (`kg` on a `g`
 * ingredient): `"kg" is already a standard unit.` A code of another dimension is allowed.
 *
 * **Conversion**: `base_qty = round_half_up(qty × factor, 3)`, exact (brick/math).
 */
final class UnitConversion
{
    public const MESSAGE_UNKNOWN = 'Add "%s" to %s\'s units first.';

    public const MESSAGE_RESERVED = '"%s" is already a standard unit.';

    /**
     * The unit of a product's stock.
     */
    public const PRODUCT_UNIT = 'pc';

    /**
     * The catalog, memoised per process (read-only reference data).
     *
     * @var Collection<int, Unit>|null
     */
    private static ?Collection $catalog = null;

    /**
     * The unit catalog, in its display order.
     *
     * @return Collection<int, Unit>
     */
    public static function catalog(): Collection
    {
        return self::$catalog ??= Unit::query()->orderBy('sort_order')->get();
    }

    /**
     * The catalog units of a dimension (`mass`, `volume`, `count`).
     *
     * @return Collection<int, Unit>
     */
    public static function catalogFor(string $dimension): Collection
    {
        return self::catalog()->where('dimension', $dimension)->values();
    }

    /**
     * Whether an own unit name reuses a catalog code of the base unit's dimension.
     */
    public static function isReserved(string $baseUnit, string $name): bool
    {
        $dimension = Ingredient::BASE_UNITS[$baseUnit] ?? null;

        return $dimension !== null && self::catalogFor($dimension)
            ->contains(fn (Unit $unit) => Str::lower($unit->code) === Str::lower(trim($name)));
    }

    public static function reservedMessage(string $name): string
    {
        return sprintf(self::MESSAGE_RESERVED, trim($name));
    }

    public static function unknownMessage(string $unit, string $itemName): string
    {
        return sprintf(self::MESSAGE_UNKNOWN, $unit, $itemName);
    }

    /**
     * The ingredient's unit named `$unit`, or null when it isn't valid for the ingredient.
     * Uses the `units` relation (loaded once).
     */
    public static function forIngredient(Ingredient $ingredient, string $unit): ?ResolvedUnit
    {
        $key = Str::lower(trim($unit));

        /** @var IngredientUnit|null $own */
        $own = $ingredient->loadMissing('units')->units
            ->first(fn (IngredientUnit $candidate) => Str::lower($candidate->name) === $key);

        if ($own !== null) {
            return new ResolvedUnit($own->name, Quantity::normalize((string) $own->factor));
        }

        /** @var Unit|null $catalog */
        $catalog = self::catalogFor($ingredient->dimension())
            ->first(fn (Unit $candidate) => Str::lower($candidate->code) === $key);

        return $catalog === null ? null : new ResolvedUnit($catalog->code, Quantity::normalize((string) $catalog->factor_to_base));
    }

    /**
     * A product's unit: `pc` (factor 1) only.
     */
    public static function forProduct(string $unit): ?ResolvedUnit
    {
        return Str::lower(trim($unit)) === self::PRODUCT_UNIT ? new ResolvedUnit(self::PRODUCT_UNIT, '1') : null;
    }

    /**
     * base_qty = round_half_up(qty × factor, 3).
     */
    public static function toBase(BigNumber|string $qty, BigNumber|string $factor): BigDecimal
    {
        return Quantity::round(BigDecimal::of($qty)->multipliedBy($factor), Quantity::SCALE);
    }

    /**
     * A base quantity in a unit: round_half_up(base / factor, 3).
     */
    public static function fromBase(BigNumber|string $baseQty, BigNumber|string $factor): BigDecimal
    {
        return BigDecimal::of($baseQty)->dividedBy($factor, Quantity::SCALE, RoundingMode::HalfUp);
    }
}
