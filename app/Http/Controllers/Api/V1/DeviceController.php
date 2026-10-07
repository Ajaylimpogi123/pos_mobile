<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Devices\RegisterDeviceAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Devices\RegisterDeviceRequest;
use App\Http\Resources\DeviceResource;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Device registration (Phase 5): the app registers itself silently after login, session
 * restore and a PIN switch, and gets the code used in its offline order numbers.
 */
class DeviceController extends Controller
{
    /**
     * POST /api/v1/devices/register
     *
     * Always 200 (a new or an existing device); 409 when the install belongs to another branch.
     */
    public function register(RegisterDeviceRequest $request, RegisterDeviceAction $register): JsonResponse
    {
        $this->authorize('register', Device::class);

        /** @var User $caller */
        $caller = $request->user();

        /** @var PersonalAccessToken $token */
        $token = $caller->currentAccessToken();

        $device = $register->execute(
            caller: $caller,
            token: $token,
            installId: $request->validated('install_id'),
            name: $request->validated('name'),
            appVersion: $request->validated('app_version'),
            ip: $request->ip(),
        );

        return (new DeviceResource($device))
            ->response()
            ->setStatusCode(200);
    }
}
