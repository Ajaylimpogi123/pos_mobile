<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Category;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Applies a partial update to a category. Only the fields actually changed are
 * written to the `category.updated` audit entry (`{ field: { from, to } }`).
 * A request that changes nothing writes nothing and leaves `updated_at` alone.
 */
class UpdateCategoryAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     */
    public function execute(Category $category, array $attributes, User $actor, ?string $ip = null): Category
    {
        return DB::transaction(function () use ($category, $attributes, $actor, $ip): Category {
            $category->fill($attributes);

            $changes = ModelChanges::diff($category);

            if ($changes === []) {
                return $category;
            }

            $category->forceFill(['updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'category.updated',
                actor: $actor,
                subject: $category,
                changes: $changes,
                ip: $ip,
            );

            return $category;
        });
    }
}
