<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Staff\CreateStaffUserAction;
use App\Actions\Staff\DeleteStaffUserAction;
use App\Actions\Staff\ResetStaffPasswordAction;
use App\Actions\Staff\SetStaffPinAction;
use App\Actions\Staff\UpdateStaffUserAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ListUsersRequest;
use App\Http\Requests\Admin\Staff\ResetStaffPasswordRequest;
use App\Http\Requests\Admin\Staff\SetStaffPinRequest;
use App\Http\Requests\Admin\Staff\StoreStaffUserRequest;
use App\Http\Requests\Admin\Staff\UpdateStaffUserRequest;
use App\Http\Resources\StaffUserResource;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Staff management (permission `user.manage`, plus the role hierarchy in UserPolicy).
 * `{user}` resolves only within the caller's branch (see AppServiceProvider), so a user
 * of another branch is a 404 on every endpoint.
 */
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

        $caller = $this->actor($request);
        $search = $request->search();
        $roleId = $request->integerFilter('role_id');
        $isActive = $request->booleanFilter('is_active');

        $users = User::query()
            ->with('role.permissions')
            ->where('branch_id', $caller->branch_id)
            ->when($search !== null, function ($query) use ($search) {
                $term = SearchPattern::contains($search);

                $query->where(fn ($q) => $q->where('name', 'like', $term)->orWhere('email', 'like', $term));
            })
            ->when($roleId !== null, fn ($query) => $query->where('role_id', $roleId))
            ->when($isActive !== null, fn ($query) => $query->where('is_active', $isActive))
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return StaffUserResource::collection($users);
    }

    /**
     * POST /api/v1/admin/users
     */
    public function store(StoreStaffUserRequest $request, CreateStaffUserAction $create): JsonResponse
    {
        $this->authorize('create', User::class);

        $user = $create->execute($request->validated(), $this->actor($request), $request->ip());

        return (new StaffUserResource($user))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/admin/users/{user}
     */
    public function show(User $user): StaffUserResource
    {
        $this->authorize('view', $user);

        return new StaffUserResource($user->loadMissing('role'));
    }

    /**
     * PATCH /api/v1/admin/users/{user}
     */
    public function update(UpdateStaffUserRequest $request, User $user, UpdateStaffUserAction $update): StaffUserResource
    {
        $this->authorize('update', $user);

        $user = $update->execute($user, $request->validated(), $this->actor($request), $request->ip());

        return new StaffUserResource($user->loadMissing('role'));
    }

    /**
     * DELETE /api/v1/admin/users/{user}
     */
    public function destroy(Request $request, User $user, DeleteStaffUserAction $delete): Response
    {
        $this->authorize('delete', $user);

        $delete->execute($user, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * POST /api/v1/admin/users/{user}/password
     */
    public function resetPassword(ResetStaffPasswordRequest $request, User $user, ResetStaffPasswordAction $reset): Response
    {
        $this->authorize('resetPassword', $user);

        $reset->execute($user, $request->validated('password'), $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * PUT /api/v1/admin/users/{user}/pin
     */
    public function setPin(SetStaffPinRequest $request, User $user, SetStaffPinAction $setPin): StaffUserResource
    {
        $this->authorize('setPin', $user);

        $user = $setPin->execute($user, $request->pin(), $this->actor($request), $request->ip());

        return new StaffUserResource($user->loadMissing('role'));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
