<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Http\Requests\CursorListRequest;
use App\Models\Ingredient;

/**
 * GET /api/v1/admin/ingredients (`product.manage`, `inventory.adjust`, any purchase permission
 * or `report.view`): `per_page`, `cursor`, `search` (name) and `is_active`.
 */
class ListIngredientsRequest extends CursorListRequest
{
    protected array $booleanFilters = ['is_active'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Ingredient::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
