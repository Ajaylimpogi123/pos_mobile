<?php

namespace App\Http\Requests\Admin\Tables;

use App\Http\Requests\CursorListRequest;
use App\Models\DiningTable;

/**
 * GET /api/v1/admin/tables (permission `settings.manage`; `per_page` 1–100, default 100).
 */
class ListDiningTablesRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', DiningTable::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [];
    }
}
