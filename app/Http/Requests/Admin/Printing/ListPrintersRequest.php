<?php

namespace App\Http\Requests\Admin\Printing;

use App\Http\Requests\CursorListRequest;
use App\Models\Printer;

/**
 * GET /api/v1/admin/printers (permission `settings.manage`).
 */
class ListPrintersRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Printer::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [];
    }
}
