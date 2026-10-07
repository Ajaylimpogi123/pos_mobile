<?php

namespace App\Actions\Inventory;

use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;
use LogicException;

/**
 * Appends one row to the stock ledger and applies it to the cached level in the same
 * transaction (PROJECT_MEMORY §4.5). The caller holds the level's row lock
 * (`lockForUpdate`, or StockLevel::lockOrCreate) and decides whether the result may
 * go below zero.
 *
 * execute() writes a product movement (whole units, as since Phase 3). executeForIngredient()
 * writes an ingredient movement (Ingredients, Recipes & Purchasing → B): base units with 3
 * decimals, the entered quantity and unit, `value_cents`, and the weighted-average cost:
 *
 * - a `receipt` of `b` base units costing `c` centavos (a correction: both negative), with
 *   `q = max(qty_before, 0)`: `avg_cost = round_half_up((q × avg_cost + c) / (q + b), 6)` and
 *   `value_cents = c`. When `q + b ≤ 0`, or the result would be negative (a correction after the
 *   stock was used), `avg_cost` is unchanged (provisional, Q-030);
 * - any other movement of `b`: `value_cents = ±round_half_up(|b| × avg_cost, 0)` (or the given
 *   value), and `avg_cost` is unchanged;
 * - a recipe component's `void` (Round B, Q-032; written set-based by App\Actions\Recipes\RecipeStock)
 *   returns at its snapshot cost `c` and re-weights `avg_cost` with averageAfterReceipt(), like a receipt;
 * - a `revaluation` (D1, Set cost): `qty_delta` 0, `avg_cost` becomes the given one, and
 *   `value_cents` is the change in the stock value (revaluationValue()), so Σ `value_cents` keeps
 *   reconciling with round_half_up(max(qty, 0) × avg_cost).
 */
class RecordStockMovementAction
{
    /**
     * @param  StockLevel  $level  Locked by the caller; updated in place
     * @param  string  $type  One of the StockMovement::TYPE_* constants
     * @param  int  $qtyDelta  Whole units: negative for a sale
     * @param  Model|null  $reference  The source record (the order of a sale)
     * @param  string|null  $ulid  The client ULID (adjustments), or null to generate one
     */
    public function execute(
        StockLevel $level,
        string $type,
        int $qtyDelta,
        ?int $unitCostCents,
        ?User $actor,
        CarbonInterface $occurredAt,
        ?Model $reference = null,
        ?string $reason = null,
        ?string $ulid = null,
    ): StockMovement {
        $movement = new StockMovement;
        $movement->forceFill([
            'ulid' => $ulid ?? (string) Str::ulid(),
            'branch_id' => $level->branch_id,
            'product_id' => $level->product_id,
            'type' => $type,
            'qty_delta' => $qtyDelta,
            'unit_cost_cents' => $unitCostCents,
            'reference_type' => $reference?->getMorphClass(),
            'reference_id' => $reference?->getKey(),
            'reason' => $reason,
            'occurred_at' => $occurredAt,
            'created_by' => $actor?->id,
        ])->save();

        $level->forceFill(['qty' => $level->wholeQty() + $qtyDelta])->save();

        return $movement;
    }

    /**
     * @param  StockLevel  $level  An ingredient's level, locked by the caller; updated in place
     * @param  string  $type  One of the StockMovement::TYPE_* constants
     * @param  BigDecimal  $qtyDelta  Base units (3 decimals): negative for a use or wastage
     * @param  int|null  $valueCents  A receipt's cost `c` (required for a receipt, signed like
     *                                the qty); for any other type an explicit value, or null to
     *                                value it at the level's `avg_cost`
     * @param  string|null  $enteredQty  The quantity as entered, in `$enteredUnit`
     * @param  BigDecimal|null  $newAvgCost  A `revaluation`'s new `avg_cost` (required for it, and
     *                                       only for it; `$qtyDelta` must be 0)
     */
    public function executeForIngredient(
        StockLevel $level,
        string $type,
        BigDecimal $qtyDelta,
        ?int $valueCents,
        ?int $unitCostCents,
        ?User $actor,
        CarbonInterface $occurredAt,
        ?string $enteredQty = null,
        ?string $enteredUnit = null,
        ?Model $reference = null,
        ?string $reason = null,
        ?string $ulid = null,
        ?BigDecimal $newAvgCost = null,
    ): StockMovement {
        $before = BigDecimal::of((string) $level->qty);
        $avgCost = BigDecimal::of((string) $level->avg_cost);

        if (($type === StockMovement::TYPE_REVALUATION) !== ($newAvgCost !== null)) {
            throw new LogicException('A revaluation, and only a revaluation, sets the average cost.');
        }

        if ($type === StockMovement::TYPE_REVALUATION) {
            if (! $qtyDelta->isZero()) {
                throw new LogicException('A revaluation does not move stock.');
            }

            $value = self::revaluationValue($before, $avgCost, $newAvgCost);
            $avgCost = $newAvgCost;
        } elseif ($type === StockMovement::TYPE_RECEIPT) {
            $value = (int) $valueCents;
            $avgCost = self::averageAfterReceipt($before, $avgCost, $qtyDelta, $value);
        } else {
            $value = $valueCents ?? self::valueAt($qtyDelta, $avgCost);
        }

        $movement = new StockMovement;
        $movement->forceFill([
            'ulid' => $ulid ?? (string) Str::ulid(),
            'branch_id' => $level->branch_id,
            'product_id' => null,
            'ingredient_id' => $level->ingredient_id,
            'type' => $type,
            'qty_delta' => (string) $qtyDelta,
            'entered_qty' => $enteredQty,
            'entered_unit' => $enteredUnit,
            'unit_cost_cents' => $unitCostCents,
            'value_cents' => $value,
            'reference_type' => $reference?->getMorphClass(),
            'reference_id' => $reference?->getKey(),
            'reason' => $reason,
            'occurred_at' => $occurredAt,
            'created_by' => $actor?->id,
        ])->save();

        $level->forceFill([
            'qty' => (string) $before->plus($qtyDelta),
            'avg_cost' => (string) $avgCost->toScale(Quantity::COST_SCALE, RoundingMode::HalfUp),
        ])->save();

        return $movement;
    }

    /**
     * The weighted-average cost after a receipt of `$qty` base units costing `$costCents`
     * (both negative for a correction).
     */
    public static function averageAfterReceipt(BigDecimal $qtyBefore, BigDecimal $avgCost, BigDecimal $qty, int $costCents): BigDecimal
    {
        $q = Quantity::max($qtyBefore, BigDecimal::zero());
        $total = $q->plus($qty);

        if ($total->isNegativeOrZero()) {
            return $avgCost;
        }

        $average = $q->multipliedBy($avgCost)->plus($costCents)->dividedBy($total, Quantity::COST_SCALE, RoundingMode::HalfUp);

        return $average->isNegative() ? $avgCost : $average;
    }

    /**
     * A revaluation's value (D1): the change in the stock value,
     * round_half_up(max(qty, 0) × new, 0) − round_half_up(max(qty, 0) × old, 0).
     */
    public static function revaluationValue(BigDecimal $qty, BigDecimal $oldAvgCost, BigDecimal $newAvgCost): int
    {
        $q = Quantity::max($qty, BigDecimal::zero());

        return self::valueAt($q, $newAvgCost) - self::valueAt($q, $oldAvgCost);
    }

    /**
     * The value of a movement at a cost rate: ±round_half_up(|qty| × rate, 0).
     */
    public static function valueAt(BigDecimal $qty, BigDecimal $rate): int
    {
        return Quantity::roundToInt($qty->multipliedBy($rate));
    }
}
