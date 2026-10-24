<?php

namespace App\Http\Resources;

use App\Models\Shift;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/shifts/current (Q-035): `{ "data": Shift }`, or `{ "data": null }` when the
 * token's device has no open shift. The Shift is exactly ShiftResource's.
 *
 * @mixin Shift
 */
class CurrentShiftResource extends ShiftResource
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        if ($this->resource === null) {
            return new JsonResponse(['data' => null]);
        }

        return parent::toResponse($request);
    }
}
