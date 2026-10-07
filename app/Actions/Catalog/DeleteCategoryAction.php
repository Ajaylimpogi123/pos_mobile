<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Category;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a category that has no (non-deleted) products and writes a
 * `category.deleted` audit entry. The image file is kept (not required on soft delete).
 *
 * The category row is locked FOR UPDATE, and product create/update take a shared
 * lock on their category, so a product cannot land in a category being deleted.
 */
class DeleteCategoryAction
{
    public const MESSAGE_HAS_PRODUCTS = 'This category still has products. Move or delete them first.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when the category still has products
     */
    public function execute(Category $category, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($category, $actor, $ip): void {
            Category::query()->whereKey($category->getKey())->lockForUpdate()->first();

            if ($category->products()->exists()) {
                throw new ConflictException(self::MESSAGE_HAS_PRODUCTS);
            }

            $category->forceFill(['updated_by' => $actor->id])->save();
            $category->delete();

            $this->recordAuditLog->execute(
                action: 'category.deleted',
                actor: $actor,
                subject: $category,
                changes: ['name' => $category->name],
                ip: $ip,
            );
        });
    }
}
