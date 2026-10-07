<?php

namespace App\Http\Requests\Admin\Staff;

use App\Http\Requests\CursorListRequest;
use App\Models\Role;

/**
 * GET /api/v1/admin/roles (permission `user.manage`).
 */
class ListRolesRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Role::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [];
    }
}
