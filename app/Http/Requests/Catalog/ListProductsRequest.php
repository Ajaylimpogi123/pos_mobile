<?php

namespace App\Http\Requests\Catalog;

use App\Http\Requests\CursorListRequest;

/**
 * GET /api/v1/products (any authenticated user).
 */
class ListProductsRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 50;

    protected function filterRules(): array
    {
        return [
            'category_id' => ['sometimes', 'integer'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ];
    }
}
