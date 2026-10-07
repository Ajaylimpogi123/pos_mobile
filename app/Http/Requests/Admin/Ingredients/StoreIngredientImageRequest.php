<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Http\Requests\Admin\Catalog\CatalogImageRequest;
use App\Models\Ingredient;

/**
 * POST /api/v1/admin/ingredients/{ingredient}/image (multipart, field `image`; permission
 * `product.manage`), with the catalogue image rules.
 */
class StoreIngredientImageRequest extends CatalogImageRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        /** @var Ingredient $ingredient */
        $ingredient = $this->route('ingredient');

        return $this->user()?->can('update', $ingredient) ?? false;
    }
}
