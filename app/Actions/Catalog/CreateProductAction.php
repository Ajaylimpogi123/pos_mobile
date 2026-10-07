<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Product;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Creates a product and writes a `product.created` audit entry.
 */
class CreateProductAction
{
    public const AUDITED_FIELDS = [
        'category_id', 'sku', 'name', 'description', 'price_cents', 'cost_cents',
        'is_vatable', 'is_available', 'stock_mode', 'track_stock', 'sort_order',
    ];

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly LockCategoryForProduct $lockCategory,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     */
    public function execute(array $attributes, User $actor, ?string $ip = null): Product
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): Product {
            $this->lockCategory->execute((int) $attributes['category_id']);

            $product = new Product;
            $product->fill($attributes);
            $product->forceFill(['created_by' => $actor->id, 'updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'product.created',
                actor: $actor,
                subject: $product,
                changes: ModelChanges::created($product, self::AUDITED_FIELDS),
                ip: $ip,
            );

            return $product;
        });
    }
}
