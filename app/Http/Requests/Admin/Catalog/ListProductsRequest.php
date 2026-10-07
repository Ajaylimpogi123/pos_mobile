<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Http\Requests\CursorListRequest;
use App\Models\Product;

/**
 * GET /api/v1/admin/products (permission `product.manage`).
 */
class ListProductsRequest extends CursorListRequest
{
    protected array $booleanFilters = ['is_available'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Product::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'category_id' => ['sometimes', 'integer'],
            'is_available' => ['sometimes', 'boolean'],
        ];
    }
}
