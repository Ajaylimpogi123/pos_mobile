<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\CursorListRequest;

/**
 * GET /api/v1/auth/pin-users (any authenticated user).
 */
class ListPinUsersRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    public function authorize(): bool
    {
        return true;
    }

    protected function filterRules(): array
    {
        return [];
    }
}
