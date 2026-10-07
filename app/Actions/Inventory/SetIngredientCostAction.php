<?php

namespace App\Actions\Inventory;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Exceptions\ConflictException;
use App\Models\Ingredient;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Quantity;
use App\Support\Units\ResolvedUnit;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Support\Facades\DB;

/**
 * Sets an ingredient's cost in the caller's branch (POST /api/v1/admin/ingredients/{ingredient}/cost;
 * Ingredients, Recipes & Purchasing → D1): `cost_cents` is the price of one `unit`, and
 *
 * - `new_avg = round_half_up(cost_cents / factor(unit), 6)`, in centavos per base unit (averageFor();
 *   the FormRequest rejects a cost that rounds to 0);
 * - under the level's row lock (created when missing): one `revaluation` movement through
 *   RecordStockMovementAction (`qty_delta` 0, `value_cents` = the change in the stock value,
 *   `unit_cost_cents` = `cost_cents`, `entered_qty` 1 `unit`, the reason), which sets the level's
 *   `avg_cost`, and the `ingredient.cost_set` audit entry (`{ avg_cost: { from, to }, cost_cents,
 *   unit }`), in one transaction;
 * - when `new_avg` equals the current average, nothing is written.
 *
 * A ULID already recorded (the idempotency key released after a commit) writes nothing again; a
 * ULID of another movement is a 409.
 */
class SetIngredientCostAction
{
    public const MESSAGE_TOO_SMALL = 'The cost is too small for this unit.';

    public function __construct(
        private readonly RecordStockMovementAction $recordStockMovement,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * round_half_up(cost_cents / factor, 6): the average cost per base unit of `$costCents` per unit.
     */
    public static function averageFor(int $costCents, string $factor): BigDecimal
    {
        return BigDecimal::of($costCents)->dividedBy($factor, Quantity::COST_SCALE, RoundingMode::HalfUp);
    }

    /**
     * @throws ConflictException when the ULID belongs to another movement
     */
    public function execute(
        Ingredient $ingredient,
        User $actor,
        string $ulid,
        int $costCents,
        ResolvedUnit $unit,
        ?string $reason,
        ?string $ip = null,
    ): void {
        if ($this->alreadyRecorded($ulid, $ingredient, $actor)) {
            return;
        }

        $newAverage = self::averageFor($costCents, $unit->factor);

        DB::transaction(function () use ($ingredient, $actor, $ulid, $costCents, $unit, $reason, $ip, $newAverage): void {
            $level = StockLevel::lockOrCreateIngredient((int) $actor->branch_id, $ingredient->id);
            $oldAverage = BigDecimal::of((string) $level->avg_cost);

            if ($oldAverage->isEqualTo($newAverage)) {
                return;
            }

            $this->recordStockMovement->executeForIngredient(
                level: $level,
                type: StockMovement::TYPE_REVALUATION,
                qtyDelta: BigDecimal::zero(),
                valueCents: null,
                unitCostCents: $costCents,
                actor: $actor,
                occurredAt: now()->startOfSecond(),
                enteredQty: Quantity::format(1),
                enteredUnit: $unit->name,
                reason: $reason,
                ulid: $ulid,
                newAvgCost: $newAverage,
            );

            $this->recordAuditLog->execute(
                action: 'ingredient.cost_set',
                actor: $actor,
                subject: $ingredient,
                changes: [
                    'avg_cost' => ['from' => Quantity::formatCost($oldAverage), 'to' => Quantity::formatCost($newAverage)],
                    'cost_cents' => $costCents,
                    'unit' => $unit->name,
                ],
                ip: $ip,
            );
        }, 3);
    }

    /**
     * @throws ConflictException when the ULID belongs to another movement
     */
    private function alreadyRecorded(string $ulid, Ingredient $ingredient, User $actor): bool
    {
        $movement = StockMovement::query()->where('ulid', $ulid)->first();

        if ($movement === null) {
            return false;
        }

        if ($movement->type !== StockMovement::TYPE_REVALUATION
            || $movement->ingredient_id !== $ingredient->id
            || $movement->branch_id !== $actor->branch_id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        return true;
    }
}
