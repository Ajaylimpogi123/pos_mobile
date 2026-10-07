<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Models\Category;

/**
 * POST /api/v1/admin/categories/{category}/image (multipart, field `image`).
 */
class StoreCategoryImageRequest extends CatalogImageRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        /** @var Category $category */
        $category = $this->route('category');

        return $this->user()?->can('update', $category) ?? false;
    }
}
