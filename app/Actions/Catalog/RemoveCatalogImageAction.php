<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Category;
use App\Models\Ingredient;
use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Clears a category's or product's image: sets `image_path` to null, deletes the
 * file after the change commits, and writes a `category.image_removed` /
 * `product.image_removed` audit entry. Removing a missing image is a no-op.
 */
class RemoveCatalogImageAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(Category|Product|Ingredient $model, User $actor, ?string $ip = null): Category|Product|Ingredient
    {
        $oldPath = $model->image_path;

        if ($oldPath === null) {
            return $model;
        }

        DB::transaction(function () use ($model, $oldPath, $actor, $ip): void {
            $model->forceFill(['image_path' => null, 'updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: Str::snake(class_basename($model)).'.image_removed',
                actor: $actor,
                subject: $model,
                changes: ['image_path' => ['from' => $oldPath, 'to' => null]],
                ip: $ip,
            );
        });

        Storage::disk($model::catalogImageDisk())->delete($oldPath);

        return $model;
    }
}
