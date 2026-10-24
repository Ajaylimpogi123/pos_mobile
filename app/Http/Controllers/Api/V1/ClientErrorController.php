<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Errors\RecordClientErrorsAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Errors\StoreClientErrorsRequest;
use App\Http\Resources\ClientErrorsAcceptedResource;
use App\Models\Device;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * App error reports (Hardening & Pilot → B).
 */
class ClientErrorController extends Controller
{
    /**
     * POST /api/v1/client-errors
     *
     * Auth is optional (a crash can happen before login): when a valid token of an active user
     * is sent, the user, their branch and the token's device are recorded; any other token is
     * ignored. 202 `{ accepted, duplicates }`.
     */
    public function store(StoreClientErrorsRequest $request, RecordClientErrorsAction $record): JsonResponse
    {
        $user = $request->user('sanctum');
        $user = $user instanceof User && $user->is_active && ! $user->trashed() ? $user : null;

        $result = $record->execute(
            $request->clientErrors(),
            $user,
            $user !== null ? Device::ofSession($user) : null,
        );

        return (new ClientErrorsAcceptedResource($result))
            ->response()
            ->setStatusCode(202);
    }
}
