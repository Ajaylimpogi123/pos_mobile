<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Category;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Creates a category and writes a `category.created` audit entry.
 */
class CreateCategoryAction
{
    public const AUDITED_FIELDS = ['name', 'description', 'sort_order', 'is_active'];

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     */
    public function execute(array $attributes, User $actor, ?string $ip = null): Category
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): Category {
            $category = new Category;
            $category->fill($attributes);
            $category->forceFill(['created_by' => $actor->id, 'updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'category.created',
                actor: $actor,
                subject: $category,
                changes: ModelChanges::created($category, self::AUDITED_FIELDS),
                ip: $ip,
            );

            return $category;
        });
    }
}
