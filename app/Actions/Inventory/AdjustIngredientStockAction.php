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
use App\Support\Units\UnitConversion;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A manual stock change of an ingredient in the caller's branch
 * (POST /api/v1/admin/ingredients/{ingredient}/stock-adjustments; Ingredients, Recipes &
 * Purchasing → D): an `adjustment`, a `count` or a `wastage`, with the product rules
 * (AdjustStockAction) in the ingredient's base unit:
 *
 * - the entered quantity converts to base: round_half_up(qty × factor, 3);
 * - under the level's row lock, a change may not take the stock below zero (422 on `qty`:
 *   `Stock can't go below zero (<qty> <base> on hand).`), and a count sets the change to count −
 *   on hand and may not equal it (422 on `qty`: `Stock is already <qty> <base>.`);
 * - one movement (valued at the level's `avg_cost`, which doesn't change; B), the level update
 *   and the `stock.adjusted` audit entry (`{ qty: { from, to }, entered_qty, entered_unit,
 *   reason, type }`, base quantities as strings), in one transaction.
 *
 * A ULID already recorded (the idempotency key released after a commit) returns that movement;
 * a ULID of another movement is a 409.
 */
class AdjustIngredientStockAction
{
    public const MESSAGE_BELOW_ZERO = "Stock can't go below zero (%s %s on hand).";

    public const MESSAGE_ALREADY = 'Stock is already %s %s.';

    public const MESSAGE_ZERO = 'The qty field is too small to change the stock.';

    public function __construct(
        private readonly RecordStockMovementAction $recordStockMovement,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * `$qty` is in `$unit`: the counted quantity for a `count`, else the signed change.
     *
     * @throws ValidationException 422 on `qty`
     */
    public function execute(
        Ingredient $ingredient,
        User $actor,
        string $ulid,
        string $type,
        string $qty,
        ResolvedUnit $unit,
        string $reason,
        ?string $ip = null,
    ): IngredientStockAdjustmentResult {
        $recorded = $this->alreadyRecorded($ulid, $ingredient, $actor, $type);

        if ($recorded !== null) {
            return $recorded;
        }

        return DB::transaction(function () use ($ingredient, $actor, $ulid, $type, $qty, $unit, $reason, $ip): IngredientStockAdjustmentResult {
            $level = StockLevel::lockOrCreateIngredient((int) $actor->branch_id, $ingredient->id);
            $before = BigDecimal::of((string) $level->qty);
            $base = $ingredient->base_unit;
            $entered = $qty;

            if ($type === StockMovement::TYPE_COUNT) {
                $counted = UnitConversion::toBase($qty, $unit->factor);

                if ($counted->isEqualTo($before)) {
                    throw ValidationException::withMessages(['qty' => sprintf(self::MESSAGE_ALREADY, Quantity::format($before), $base)]);
                }

                $delta = $counted->minus($before);
            } else {
                $delta = UnitConversion::toBase($qty, $unit->factor);

                if ($delta->isZero()) {
                    throw ValidationException::withMessages(['qty' => self::MESSAGE_ZERO]);
                }

                if ($before->plus($delta)->isNegative()) {
                    throw ValidationException::withMessages(['qty' => sprintf(self::MESSAGE_BELOW_ZERO, Quantity::format($before), $base)]);
                }
            }

            $movement = $this->recordStockMovement->executeForIngredient(
                level: $level,
                type: $type,
                qtyDelta: $delta,
                valueCents: null,
                unitCostCents: null,
                actor: $actor,
                occurredAt: now()->startOfSecond(),
                enteredQty: $entered,
                enteredUnit: $unit->name,
                reason: $reason,
                ulid: $ulid,
            );

            $after = $before->plus($delta);

            $this->recordAuditLog->execute(
                action: 'stock.adjusted',
                actor: $actor,
                subject: $ingredient,
                changes: [
                    'qty' => ['from' => Quantity::format($before), 'to' => Quantity::format($after)],
                    'entered_qty' => Quantity::format($entered),
                    'entered_unit' => $unit->name,
                    'reason' => $reason,
                    'type' => $type,
                ],
                ip: $ip,
            );

            return new IngredientStockAdjustmentResult($movement->setRelation('creator', $actor), Quantity::format($before), Quantity::format($after));
        }, 3);
    }

    /**
     * @throws ConflictException when the ULID belongs to another movement
     */
    private function alreadyRecorded(string $ulid, Ingredient $ingredient, User $actor, string $type): ?IngredientStockAdjustmentResult
    {
        $movement = StockMovement::query()->where('ulid', $ulid)->first();

        if ($movement === null) {
            return null;
        }

        if ($movement->type !== $type
            || $movement->ingredient_id !== $ingredient->id
            || $movement->branch_id !== $actor->branch_id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        $after = (string) StockMovement::query()
            ->where('branch_id', $movement->branch_id)
            ->where('ingredient_id', $movement->ingredient_id)
            ->where('id', '<=', $movement->id)
            ->sum('qty_delta');

        return new IngredientStockAdjustmentResult(
            $movement->load('creator'),
            Quantity::format(BigDecimal::of($after)->minus((string) $movement->qty_delta)),
            Quantity::format($after),
        );
    }
}
