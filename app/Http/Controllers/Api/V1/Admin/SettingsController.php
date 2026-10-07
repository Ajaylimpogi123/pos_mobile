<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Printing\UpdateBranchSettingsAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Printing\UpdateBranchSettingsRequest;
use App\Http\Resources\BranchSettingsResource;
use App\Models\Branch;
use App\Models\Setting;
use App\Models\User;
use App\Support\BranchSettings;
use Illuminate\Http\Request;

/**
 * The caller's branch receipt settings (permission `settings.manage`). The branch always
 * comes from the authenticated user.
 */
class SettingsController extends Controller
{
    /**
     * GET /api/v1/admin/settings
     */
    public function show(Request $request): BranchSettingsResource
    {
        $this->authorize('view', Setting::class);

        return new BranchSettingsResource(BranchSettings::for($this->branch($request)));
    }

    /**
     * PATCH /api/v1/admin/settings
     */
    public function update(UpdateBranchSettingsRequest $request, UpdateBranchSettingsAction $update): BranchSettingsResource
    {
        $this->authorize('update', Setting::class);

        /** @var User $actor */
        $actor = $request->user();

        return new BranchSettingsResource(
            $update->execute($this->branch($request), $request->validated(), $actor, $request->ip()),
        );
    }

    private function branch(Request $request): Branch
    {
        /** @var User $caller */
        $caller = $request->user();

        return $caller->branch()->firstOrFail();
    }
}
