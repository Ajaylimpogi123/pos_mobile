<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\User;
use App\Support\ModelChanges;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Applies a partial update to a product. Only the fields actually changed are
 * written to the `product.updated` audit entry, e.g.
 * `{ "price_cents": { "from": 5000, "to": 5500 } }`.
 * A request that changes nothing writes nothing and leaves `updated_at` alone.
 *
 * Round B: `stock_mode` changes follow the switching rules (`own` → anything else needs the
 * stock ≤ 0: 409); a flip of the derived `track_stock` is audited beside `stock_mode`.
 */
class UpdateProductAction
{
    public const MESSAGE_STOCK_LEFT = 'Use up or write off the stock first.';

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly LockCategoryForProduct $lockCategory,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     */
    public function execute(Product $product, array $attributes, User $actor, ?string $ip = null): Product
    {
        return DB::transaction(function () use ($product, $attributes, $actor, $ip): Product {
            $product->fill($attributes);

            $changes = ModelChanges::diff($product);

            if ($changes === []) {
                return $product;
            }

            if (array_key_exists('category_id', $changes)) {
                $this->lockCategory->execute($product->category_id);
            }

            if (array_key_exists('stock_mode', $changes)) {
                $this->checkStockModeSwitch($product, (string) $changes['stock_mode']['from']);

                // `track_stock` (derived) is audited too while it flips, as before Round B.
                $wasOwn = $changes['stock_mode']['from'] === Product::STOCK_OWN;

                if ($wasOwn !== $product->track_stock) {
                    $changes['track_stock'] = ['from' => $wasOwn, 'to' => $product->track_stock];
                }
            }

            $product->forceFill(['updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'product.updated',
                actor: $actor,
                subject: $product,
                changes: $changes,
                ip: $ip,
            );

            return $product;
        });
    }

    /**
     * Round B (Ingredients, Recipes & Purchasing → J): leaving `own` needs the product's stock
     * to be ≤ 0 in every branch (its levels are locked, so a concurrent stock-in waits). Leaving
     * `recipe` keeps the recipe rows (they are ignored).
     *
     * @throws ConflictException
     */
    private function checkStockModeSwitch(Product $product, string $from): void
    {
        if ($from !== Product::STOCK_OWN) {
            return;
        }

        $inStock = StockLevel::query()
            ->where('product_id', $product->id)
            ->orderBy('id')
            ->lockForUpdate()
            ->pluck('qty')
            ->contains(fn ($qty) => BigDecimal::of((string) $qty)->isPositive());

        if ($inStock) {
            throw new ConflictException(self::MESSAGE_STOCK_LEFT);
        }
    }
}
