<?php

namespace App\Http\Requests\Tabs;

use App\Exceptions\ConflictException;
use App\Http\Requests\CursorListRequest;
use App\Models\Tab;
use App\Models\User;
use App\Support\DineIn;

/**
 * GET /api/v1/tables (`sale.create`; `per_page` 1–100, default 100). `403` without
 * `sale.create`, then `409` while dine-in is off.
 */
class ListTablesRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    /**
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('viewAny', Tab::class)) {
            return false;
        }

        DineIn::ensureEnabled($user);

        return true;
    }

    protected function filterRules(): array
    {
        return [];
    }
}
