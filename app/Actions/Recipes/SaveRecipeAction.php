<?php

namespace App\Actions\Recipes;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Product;
use App\Models\RecipeLine;
use App\Models\User;
use App\Support\Quantity;
use Illuminate\Support\Facades\DB;

/**
 * Replaces a `recipe` product's recipe (PUT /api/v1/admin/products/{product}/recipe; Ingredients,
 * Recipes & Purchasing → J) with the validated lines, in the order sent, and audits
 * `recipe.updated` (`changes: { lines: { from, to } }`, each line `{component_type, component_id,
 * name, qty, unit, base_qty}`). A recipe that doesn't change writes nothing.
 *
 * The product row is locked, so a concurrent stock-mode switch waits. A product that isn't
 * `recipe` returns 409 (provisional wording, Q-031).
 */
class SaveRecipeAction
{
    public const MESSAGE_NOT_RECIPE = "This product doesn't use a recipe.";

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  list<RecipeLineInput>  $lines
     *
     * @throws ConflictException
     */
    public function execute(Product $product, array $lines, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($product, $lines, $actor, $ip): void {
            self::lockRecipeProduct($product);

            $current = RecipeLine::query()
                ->where('product_id', $product->id)
                ->with(['ingredient', 'componentProduct'])
                ->orderBy('id')
                ->get();

            $before = $current->map(fn (RecipeLine $line) => [
                'component_type' => $line->componentType(),
                'component_id' => (int) ($line->ingredient_id ?? $line->component_product_id),
                'name' => $line->ingredient_id !== null ? $line->ingredient->name : $line->componentProduct->name,
                'qty' => Quantity::format((string) $line->qty),
                'unit' => $line->unit,
                'base_qty' => Quantity::format((string) $line->base_qty),
            ])->values()->all();

            $after = array_map(fn (RecipeLineInput $line) => [
                'component_type' => $line->isIngredient() ? RecipeLine::COMPONENT_INGREDIENT : RecipeLine::COMPONENT_PRODUCT,
                'component_id' => $line->component->id,
                'name' => $line->component->name,
                'qty' => Quantity::format($line->quantity->qty),
                'unit' => $line->quantity->unit->name,
                'base_qty' => Quantity::format($line->quantity->baseQty),
            ], $lines);

            if ($before === $after) {
                return;
            }

            RecipeLine::query()->where('product_id', $product->id)->delete();

            $now = now();

            RecipeLine::query()->insert(array_map(fn (RecipeLineInput $line) => [
                'product_id' => $product->id,
                'ingredient_id' => $line->isIngredient() ? $line->component->id : null,
                'component_product_id' => $line->isIngredient() ? null : $line->component->id,
                'qty' => Quantity::format($line->quantity->qty),
                'unit' => $line->quantity->unit->name,
                'base_qty' => Quantity::format($line->quantity->baseQty),
                'created_at' => $now,
                'updated_at' => $now,
            ], $lines));

            $this->recordAuditLog->execute(
                action: 'recipe.updated',
                actor: $actor,
                subject: $product,
                changes: ['lines' => ['from' => $before, 'to' => $after]],
                ip: $ip,
            );
        });
    }

    /**
     * Locks the product row and requires `stock_mode = recipe`.
     *
     * @throws ConflictException
     */
    public static function lockRecipeProduct(Product $product): Product
    {
        /** @var Product $locked */
        $locked = Product::query()->whereKey($product->id)->lockForUpdate()->firstOrFail();

        if ($locked->stock_mode !== Product::STOCK_RECIPE) {
            throw new ConflictException(self::MESSAGE_NOT_RECIPE);
        }

        return $locked;
    }
}
