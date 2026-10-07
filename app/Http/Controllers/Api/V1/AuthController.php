<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Auth\LoginAction;
use App\Actions\Auth\LogoutAction;
use App\Actions\Auth\PinSwitchAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ListPinUsersRequest;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\PinSwitchRequest;
use App\Http\Resources\AuthUserResource;
use App\Http\Resources\LoginResource;
use App\Http\Resources\PinUserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class AuthController extends Controller
{
    /**
     * POST /api/v1/auth/login
     */
    public function login(LoginRequest $request, LoginAction $login): LoginResource
    {
        $result = $login->execute(
            email: $request->validated('email'),
            password: $request->validated('password'),
            ip: $request->ip(),
        );

        return new LoginResource($result);
    }

    /**
     * GET /api/v1/auth/me
     */
    public function me(Request $request): AuthUserResource
    {
        /** @var User $user */
        $user = $request->user();
        $user->loadMissing(['role.permissions', 'branch']);

        return new AuthUserResource($user);
    }

    /**
     * POST /api/v1/auth/logout
     */
    public function logout(Request $request, LogoutAction $logout): Response
    {
        /** @var User $user */
        $user = $request->user();

        $logout->execute($user, $user->currentAccessToken(), $request->ip());

        return response()->noContent();
    }

    /**
     * GET /api/v1/auth/pin-users
     *
     * Who can PIN-switch on this device: active, non-deleted users of the caller's branch
     * with a PIN (the caller included), ordered by name then id, cursor-paginated.
     */
    public function pinUsers(ListPinUsersRequest $request): AnonymousResourceCollection
    {
        /** @var User $caller */
        $caller = $request->user();

        $users = User::query()
            ->with('role.permissions')
            ->where('branch_id', $caller->branch_id)
            ->where('is_active', true)
            ->whereNotNull('pin_hash')
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return PinUserResource::collection($users);
    }

    /**
     * POST /api/v1/auth/pin
     *
     * The PIN quick-switch: the same response as login, for the target user. The token
     * that made this request is revoked.
     */
    public function pin(PinSwitchRequest $request, PinSwitchAction $switch): LoginResource
    {
        /** @var User $caller */
        $caller = $request->user();

        $result = $switch->execute(
            caller: $caller,
            currentToken: $caller->currentAccessToken(),
            targetId: (int) $request->validated('user_id'),
            pin: $request->validated('pin'),
            ip: $request->ip(),
        );

        return new LoginResource($result);
    }
}
