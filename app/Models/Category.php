<?php

namespace App\Models;

use App\Models\Concerns\HasCatalogImage;
use Database\Factories\CategoryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A menu category. Global master data (not branch-scoped), soft-deleted.
 *
 * @property int $id
 * @property string $name
 * @property string|null $description
 * @property string|null $image_path
 * @property int $sort_order
 * @property bool $is_active
 * @property int|null $products_count
 */
#[Fillable(['name', 'description', 'sort_order', 'is_active'])]
class Category extends Model
{
    /** @use HasFactory<CategoryFactory> */
    use HasCatalogImage, HasFactory, SoftDeletes;

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'description' => null,
        'image_path' => null,
        'sort_order' => 0,
        'is_active' => true,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * Non-deleted products in this category.
     *
     * @return HasMany<Product, $this>
     */
    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }
}
