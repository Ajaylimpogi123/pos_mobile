<?php

namespace App\Actions\Purchasing;

use App\Models\Ingredient;
use App\Models\Product;
use App\Models\PurchaseRequestItem;
use App\Support\Quantity;
use App\Support\Units\ResolvedUnit;
use App\Support\Units\UnitConversion;

/**
 * The items of purchasing (Ingredients, Recipes & Purchasing → F, G, H): an ingredient, or a
 * product with its own stock (Round B: `stock_mode = own`; until then `track_stock = true`),
 * and their quantities.
 *
 * - An item must exist and not be deleted (`The selected item is invalid.`); an ingredient must
 *   be active (`This ingredient is inactive.`) and a product must track stock (`This product
 *   doesn't track stock.`). These apply when a PR item is created or edited.
 * - A quantity's unit must be valid for the item (UnitConversion; `Add "<unit>" to <name>'s units
 *   first.`). A product's quantity is a whole number of `pc`. `base_qty = round_half_up(qty ×
 *   factor, 3)` must not round to 0, and fits the ledger (at most 1,000,000,000 base units).
 *
 * The item messages are provisional (Q-030).
 */
class PurchaseItemResolver
{
    public const MESSAGE_INVALID_ITEM = 'The selected item is invalid.';

    public const MESSAGE_INACTIVE = 'This ingredient is inactive.';

    public const MESSAGE_NOT_TRACKED = "This product doesn't track stock.";

    public const MESSAGE_WHOLE = 'A product quantity must be a whole number.';

    public const MESSAGE_TOO_SMALL = 'The quantity is too small for this unit.';

    public const MESSAGE_TOO_LARGE = 'The quantity is too large for this unit.';

    public const MAX_BASE_QTY = '1000000000';

    /**
     * @var array<string, Ingredient|Product|null>
     */
    private array $items = [];

    /**
     * The non-deleted item (an ingredient with its units loaded), or null.
     */
    public function find(string $type, int $id): Ingredient|Product|null
    {
        return $this->items["{$type}:{$id}"] ??= match ($type) {
            PurchaseRequestItem::ITEM_INGREDIENT => Ingredient::query()->with('units')->find($id),
            PurchaseRequestItem::ITEM_PRODUCT => Product::query()->find($id),
            default => null,
        };
    }

    /**
     * Why the item can't be requested, or null when it can.
     */
    public function itemError(Ingredient|Product|null $item): ?string
    {
        return match (true) {
            $item === null => self::MESSAGE_INVALID_ITEM,
            $item instanceof Ingredient && ! $item->is_active => self::MESSAGE_INACTIVE,
            $item instanceof Product && ! $item->track_stock => self::MESSAGE_NOT_TRACKED,
            default => null,
        };
    }

    /**
     * The unit named `$unit` for the item, or null.
     */
    public function unit(Ingredient|Product $item, string $unit): ?ResolvedUnit
    {
        return $item instanceof Ingredient ? UnitConversion::forIngredient($item, $unit) : UnitConversion::forProduct($unit);
    }

    /**
     * The quantity `$qty` (a validated decimal string) in `$unit` of the item, or the field
     * (`qty` or `unit`) and message of the error.
     *
     * @param  ResolvedUnit|null  $unit  An already resolved unit (e.g. a PO line's own unit)
     * @return ResolvedQuantity|array{0: 'qty'|'unit', 1: string}
     */
    public function quantity(Ingredient|Product $item, string $qty, string $unitName, ?ResolvedUnit $unit = null): ResolvedQuantity|array
    {
        $unit ??= $this->unit($item, $unitName);

        if ($unit === null) {
            return ['unit', UnitConversion::unknownMessage($unitName, $item->name)];
        }

        if ($item instanceof Product && ! Quantity::isWhole($qty)) {
            return ['qty', self::MESSAGE_WHOLE];
        }

        $base = UnitConversion::toBase($qty, $unit->factor);

        if ($base->isZero()) {
            return ['qty', self::MESSAGE_TOO_SMALL];
        }

        if ($base->abs()->isGreaterThan(self::MAX_BASE_QTY)) {
            return ['qty', self::MESSAGE_TOO_LARGE];
        }

        return new ResolvedQuantity(Quantity::format($qty), $unit, $base);
    }

    /**
     * The unit of a PO line as a resolved unit (its own name and factor snapshot).
     */
    public static function lineUnit(string $name, string $factor): ResolvedUnit
    {
        return new ResolvedUnit($name, Quantity::normalize($factor));
    }
}
