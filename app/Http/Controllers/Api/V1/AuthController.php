<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Auth\LoginAction;
use App\Actions\Auth\LogoutAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\AuthUserResource;
use App\Http\Resources\LoginResource;
use App\Models\User;
use Illuminate\Http\Request;
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
            deviceCode: $request->validated('device_code'),
            appVersion: $request->validated('app_version'),
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
}
