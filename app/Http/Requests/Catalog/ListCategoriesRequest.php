<?php

namespace App\Http\Requests\Catalog;

use App\Http\Requests\CursorListRequest;

/**
 * GET /api/v1/categories (any authenticated user).
 */
class ListCategoriesRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    protected function filterRules(): array
    {
        return [];
    }
}
