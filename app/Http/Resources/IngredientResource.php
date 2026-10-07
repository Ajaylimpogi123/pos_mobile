<?php

namespace App\Http\Resources;

use App\Models\Ingredient;
use App\Models\IngredientUnit;
use App\Support\Quantity;
use App\Support\StockStatus;
use Brick\Math\BigDecimal;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Ingredient` (Ingredients, Recipes & Purchasing → D): `{ id, name, base_unit,
 * base_unit_locked (Q-025), image_url, image_path, is_active, units[{id, name, factor}] }` plus, for the caller's branch,
 * `qty`, `reorder_level`, `status`, `avg_cost`, `stock_value_cents` and `last_movement_at`.
 * Wraps an Ingredient from App\Actions\Inventory\IngredientInventoryQuery::items() (with the
 * `units` relation loaded).
 *
 * - `qty` and `reorder_level` are base-unit strings with exactly 3 decimals (`reorder_level`
 *   may be null); `avg_cost` is centavos per base unit, a string with 6 decimals.
 * - `stock_value_cents` = round_half_up(max(qty, 0) × avg_cost, 0).
 * - A unit's `factor` is an exact decimal string without trailing zeros (`"25000"`).
 * - `image_path` follows the Global Conventions (File uploads: responses carry both).
 *
 * @mixin Ingredient
 */
class IngredientResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $qty = (string) ($this->level_qty ?? '0');
        $reorderLevel = $this->level_reorder_level === null ? null : Quantity::format((string) $this->level_reorder_level);
        $avgCost = (string) ($this->level_avg_cost ?? '0');
        $lastMovementAt = $this->last_movement_at;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'base_unit' => $this->base_unit,
            'base_unit_locked' => (bool) $this->base_unit_locked,
            'image_url' => $this->imageUrl(),
            'image_path' => $this->image_path,
            'is_active' => (bool) $this->is_active,
            'units' => $this->units->map(fn (IngredientUnit $unit) => [
                'id' => $unit->id,
                'name' => $unit->name,
                'factor' => Quantity::normalize((string) $unit->factor),
            ])->values()->all(),
            'qty' => Quantity::format($qty),
            'reorder_level' => $reorderLevel,
            'status' => StockStatus::ofDecimal($qty, $reorderLevel),
            'avg_cost' => Quantity::formatCost($avgCost),
            'stock_value_cents' => Quantity::roundToInt(Quantity::max(BigDecimal::of($qty), BigDecimal::zero())->multipliedBy($avgCost)),
            'last_movement_at' => $lastMovementAt instanceof CarbonInterface ? $lastMovementAt->toIso8601ZuluString() : null,
        ];
    }
}
