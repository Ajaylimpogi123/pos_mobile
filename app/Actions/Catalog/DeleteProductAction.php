<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a product and writes a `product.deleted` audit entry. There is no
 * conflict rule: order lines (later phases) keep their own snapshot of the product.
 */
class DeleteProductAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(Product $product, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($product, $actor, $ip): void {
            $product->forceFill(['updated_by' => $actor->id])->save();
            $product->delete();

            $this->recordAuditLog->execute(
                action: 'product.deleted',
                actor: $actor,
                subject: $product,
                changes: ['name' => $product->name, 'sku' => $product->sku],
                ip: $ip,
            );
        });
    }
}
