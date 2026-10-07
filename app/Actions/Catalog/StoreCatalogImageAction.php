<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Category;
use App\Models\Ingredient;
use App\Models\Product;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Stores a new image for a category or product at `{table}/{id}/{random}.{ext}` on the
 * catalogue image disk, replacing (and deleting) any previous file, and writes a
 * `category.image_updated` / `product.image_updated` audit entry.
 *
 * The new file is written first; the old file is only deleted after the database
 * change commits, and the new file is removed again if the database change fails.
 */
class StoreCatalogImageAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(Category|Product|Ingredient $model, UploadedFile $image, User $actor, ?string $ip = null): Category|Product|Ingredient
    {
        $disk = Storage::disk($model::catalogImageDisk());

        $newPath = $image->storePublicly($model->catalogImageDirectory(), ['disk' => $model::catalogImageDisk()]);

        if ($newPath === false) {
            throw new RuntimeException('The image could not be stored.');
        }

        $oldPath = $model->image_path;

        try {
            DB::transaction(function () use ($model, $newPath, $oldPath, $actor, $ip): void {
                $model->forceFill(['image_path' => $newPath, 'updated_by' => $actor->id])->save();

                $this->recordAuditLog->execute(
                    action: Str::snake(class_basename($model)).'.image_updated',
                    actor: $actor,
                    subject: $model,
                    changes: ['image_path' => ['from' => $oldPath, 'to' => $newPath]],
                    ip: $ip,
                );
            });
        } catch (Throwable $e) {
            $disk->delete($newPath);

            throw $e;
        }

        if ($oldPath !== null && $oldPath !== $newPath) {
            $disk->delete($oldPath);
        }

        return $model;
    }
}
