<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Staff\ListRolesRequest;
use App\Http\Resources\RoleResource;
use App\Models\Role;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class RoleController extends Controller
{
    /**
     * GET /api/v1/admin/roles (permission `user.manage`)
     *
     * Every role ordered by id, cursor-paginated (default and max page size 100),
     * with `assignable` computed for the caller.
     */
    public function index(ListRolesRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Role::class);

        $roles = Role::query()
            ->with('permissions')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return RoleResource::collection($roles);
    }
}
