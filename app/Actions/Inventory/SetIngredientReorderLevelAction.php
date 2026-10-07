<?php

namespace App\Actions\Inventory;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Ingredient;
use App\Models\StockLevel;
use App\Models\User;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Sets or clears an ingredient's reorder level in the caller's branch, in its base unit
 * (PUT /api/v1/inventory/ingredients/{ingredient}/reorder-level). As for products
 * (SetReorderLevelAction): the level row is created at 0 when missing (no movement), under its
 * row lock, and `stock.reorder_level_changed` (`{ reorder_level: { from, to } }`, base
 * quantities as strings) is written only when the value changes.
 */
class SetIngredientReorderLevelAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(Ingredient $ingredient, User $actor, ?BigDecimal $reorderLevel, ?string $ip = null): void
    {
        DB::transaction(function () use ($ingredient, $actor, $reorderLevel, $ip): void {
            $level = StockLevel::lockOrCreateIngredient((int) $actor->branch_id, $ingredient->id);
            $from = $level->rawReorderLevel() === null ? null : Quantity::format($level->rawReorderLevel());
            $to = $reorderLevel === null ? null : Quantity::format($reorderLevel);

            if ($from === $to) {
                return;
            }

            $level->forceFill(['reorder_level' => $to])->save();

            $this->recordAuditLog->execute(
                action: 'stock.reorder_level_changed',
                actor: $actor,
                subject: $ingredient,
                changes: ['reorder_level' => ['from' => $from, 'to' => $to]],
                ip: $ip,
            );
        }, 3);
    }
}
