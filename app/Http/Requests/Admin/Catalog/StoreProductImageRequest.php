<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Models\Product;

/**
 * POST /api/v1/admin/products/{product}/image (multipart, field `image`).
 */
class StoreProductImageRequest extends CatalogImageRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        /** @var Product $product */
        $product = $this->route('product');

        return $this->user()?->can('update', $product) ?? false;
    }
}
