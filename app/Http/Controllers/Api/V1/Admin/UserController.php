<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ListUsersRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class UserController extends Controller
{
    /**
     * GET /api/v1/admin/users
     *
     * Users of the caller's branch (soft-deleted excluded, deactivated included),
     * ordered by name then id, cursor-paginated.
     */
    public function index(ListUsersRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', User::class);

        /** @var User $caller */
        $caller = $request->user();
        $search = $request->search();

        $users = User::query()
            ->with('role')
            ->where('branch_id', $caller->branch_id)
            ->when($search !== null, function ($query) use ($search) {
                $term = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search).'%';

                $query->where(fn ($q) => $q->where('name', 'like', $term)->orWhere('email', 'like', $term));
            })
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return UserResource::collection($users);
    }
}
