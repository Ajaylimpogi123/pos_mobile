<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Dashboard\BuildDashboardAction;
use App\Http\Controllers\Controller;
use App\Http\Resources\DashboardResource;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The app dashboard (Phase 1c). Open to any authenticated user; each section is
 * gated by permission inside BuildDashboardAction (a hidden section is `null`).
 */
class DashboardController extends Controller
{
    /**
     * GET /api/v1/dashboard
     */
    public function show(Request $request, BuildDashboardAction $build): DashboardResource
    {
        /** @var User $caller */
        $caller = $request->user();

        return new DashboardResource($build->execute($caller));
    }
}
