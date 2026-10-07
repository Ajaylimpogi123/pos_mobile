<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\CursorListRequest;
use App\Models\User;

/**
 * GET /api/v1/admin/users (permission `user.manage`).
 */
class ListUsersRequest extends CursorListRequest
{
    protected array $booleanFilters = ['is_active'];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', User::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'role_id' => ['sometimes', 'integer'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
