<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Http\Requests\CursorListRequest;
use App\Models\Category;

/**
 * GET /api/v1/admin/categories (permission `product.manage`).
 */
class ListCategoriesRequest extends CursorListRequest
{
    protected array $booleanFilters = ['is_active'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Category::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
