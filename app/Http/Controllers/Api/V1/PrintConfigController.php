<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Printing\BuildPrintConfigAction;
use App\Http\Controllers\Controller;
use App\Http\Resources\PrintConfigResource;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The device's print configuration (Phase 4). Open to any authenticated user: every
 * tablet that rings up sales needs it to print, and it is cached on the device so
 * printing also works offline.
 */
class PrintConfigController extends Controller
{
    /**
     * GET /api/v1/print-config
     */
    public function show(Request $request, BuildPrintConfigAction $build): PrintConfigResource
    {
        /** @var User $caller */
        $caller = $request->user();

        return new PrintConfigResource($build->execute($caller));
    }
}
