<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Devices\RenameDeviceAction;
use App\Actions\Devices\RestoreDeviceAction;
use App\Actions\Devices\RetireDeviceAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\System\ListDevicesRequest;
use App\Http\Requests\Admin\System\RetireDeviceRequest;
use App\Http\Requests\Admin\System\UpdateDeviceRequest;
use App\Http\Resources\AdminDeviceResource;
use App\Models\Device;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Admin Devices (Hardening & Pilot → C; permission `system.manage`, the caller's branch).
 * `{device}` resolves only within the caller's branch (AppServiceProvider), so another
 * branch's device is a 404 on every endpoint.
 */
class DeviceController extends Controller
{
    /**
     * GET /api/v1/admin/devices
     *
     * Active first, then by `code`; filters `status` (default `active`), `platform`, `search`.
     */
    public function index(ListDevicesRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Device::class);

        $query = Device::query()
            ->with('lastUser')
            ->where('branch_id', $this->actor($request)->branch_id);

        match ($request->status()) {
            'active' => $query->where('is_active', true),
            'retired' => $query->where('is_active', false),
            default => null,
        };

        if ($request->platform() !== null) {
            $query->where('platform', $request->platform());
        }

        if ($request->search() !== null) {
            $pattern = SearchPattern::contains($request->search());
            $query->where(fn (Builder $q) => $q->where('code', 'like', $pattern)->orWhere('name', 'like', $pattern));
        }

        $devices = $query
            ->orderByDesc('is_active')
            ->orderBy('code')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return AdminDeviceResource::collection($devices);
    }

    /**
     * GET /api/v1/admin/devices/{device} (Q-043)
     *
     * Retired devices included; another branch's device is a 404 unless the caller has
     * `branch.all`.
     */
    public function show(Device $device): AdminDeviceResource
    {
        $this->authorize('view', $device);

        return new AdminDeviceResource($device->load('lastUser'));
    }

    /**
     * PATCH /api/v1/admin/devices/{device}
     */
    public function update(UpdateDeviceRequest $request, Device $device, RenameDeviceAction $rename): AdminDeviceResource
    {
        $this->authorize('update', $device);

        $device = $rename->execute($device, $request->validated(), $this->actor($request), $request->ip());

        return new AdminDeviceResource($device->load('lastUser'));
    }

    /**
     * POST /api/v1/admin/devices/{device}/retire
     *
     * 409 with `outbox_pending` when the tablet's last heartbeat reported unsynced sales and
     * `confirm` isn't true.
     */
    public function retire(RetireDeviceRequest $request, Device $device, RetireDeviceAction $retire): AdminDeviceResource
    {
        $this->authorize('retire', $device);

        $device = $retire->execute($device, $request->confirmed(), $this->actor($request), $request->ip());

        return new AdminDeviceResource($device->load('lastUser'));
    }

    /**
     * POST /api/v1/admin/devices/{device}/restore
     */
    public function restore(Request $request, Device $device, RestoreDeviceAction $restore): AdminDeviceResource
    {
        $this->authorize('restore', $device);

        $device = $restore->execute($device, $this->actor($request), $request->ip());

        return new AdminDeviceResource($device->load('lastUser'));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
