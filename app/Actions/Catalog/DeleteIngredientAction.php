<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Inventory\IngredientUsage;
use App\Exceptions\ConflictException;
use App\Models\Ingredient;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes an ingredient (`ingredient.deleted`). Blocked (409) while it is on an open
 * purchase order (not declined, not fully received), and (Round B) while it is on a recipe of a
 * non-deleted product. The wording is provisional (Q-030, Q-031).
 */
class DeleteIngredientAction
{
    public const MESSAGE_ON_OPEN_ORDER = 'This ingredient is on an open purchase order.';

    public const MESSAGE_ON_RECIPE = 'This ingredient is on a recipe. Remove it from the recipe first.';

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly IngredientUsage $usage,
    ) {}

    /**
     * @throws ConflictException
     */
    public function execute(Ingredient $ingredient, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($ingredient, $actor, $ip): void {
            Ingredient::query()->whereKey($ingredient->id)->lockForUpdate()->first();

            if ($this->usage->isOnOpenPurchaseOrder($ingredient->id)) {
                throw new ConflictException(self::MESSAGE_ON_OPEN_ORDER);
            }

            if ($this->usage->isOnRecipe($ingredient->id)) {
                throw new ConflictException(self::MESSAGE_ON_RECIPE);
            }

            $ingredient->forceFill(['updated_by' => $actor->id])->save();
            $ingredient->delete();

            $this->recordAuditLog->execute(
                action: 'ingredient.deleted',
                actor: $actor,
                subject: $ingredient,
                changes: ['name' => $ingredient->name],
                ip: $ip,
            );
        });
    }
}
