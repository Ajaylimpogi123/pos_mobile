<?php

namespace App\Actions\Recipes;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/admin/products/{product}/recipe/apply-cost (Ingredients, Recipes & Purchasing → J):
 * sets the `recipe` product's `cost_cents` to its recipe cost per serving in the caller's branch
 * (BuildRecipe), audited as `product.updated` with `changes: { cost_cents: { from, to } }`, like
 * any cost change. Nothing is written when the cost is already that; an empty recipe sets 0.
 * Returns the product (the admin `Product`; Q-031).
 */
class ApplyRecipeCostAction
{
    public function __construct(
        private readonly BuildRecipe $buildRecipe,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @throws ConflictException 409 when the product isn't `recipe`
     */
    public function execute(Product $product, User $actor, ?string $ip = null): Product
    {
        return DB::transaction(function () use ($product, $actor, $ip): Product {
            $locked = SaveRecipeAction::lockRecipeProduct($product);
            $recipe = $this->buildRecipe->execute($locked, (int) $actor->branch_id);
            $from = (int) $locked->cost_cents;

            if ($from !== $recipe->costCents) {
                $locked->forceFill(['cost_cents' => $recipe->costCents, 'updated_by' => $actor->id])->save();

                $this->recordAuditLog->execute(
                    action: 'product.updated',
                    actor: $actor,
                    subject: $locked,
                    changes: ['cost_cents' => ['from' => $from, 'to' => $recipe->costCents]],
                    ip: $ip,
                );
            }

            return $locked;
        });
    }
}
