<?php

namespace App\Http\Requests\Admin\Purchasing;

use App\Http\Requests\CursorListRequest;
use App\Models\Supplier;

/**
 * GET /api/v1/admin/suppliers (`supplier.manage` or any purchase permission): `per_page`,
 * `cursor`, `search` (name, contact person or contact number) and `is_active`.
 */
class ListSuppliersRequest extends CursorListRequest
{
    protected array $booleanFilters = ['is_active'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Supplier::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
