<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Shifts\BuildShiftReports;
use App\Actions\Shifts\CloseShiftAction;
use App\Actions\Shifts\OpenShiftAction;
use App\Actions\Shifts\RecordCashMovementAction;
use App\Exceptions\ConflictException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Shifts\CloseShiftRequest;
use App\Http\Requests\Shifts\ListShiftsRequest;
use App\Http\Requests\Shifts\StoreCashMovementRequest;
use App\Http\Requests\Shifts\StoreShiftRequest;
use App\Http\Requests\Sync\SyncOrdersRequest;
use App\Http\Resources\CashMovementResource;
use App\Http\Resources\CurrentShiftResource;
use App\Http\Resources\ShiftResource;
use App\Models\Device;
use App\Models\Shift;
use App\Models\User;
use App\Support\BusinessDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Cash shifts (Phase 6). The writes are events the tablet made, possibly offline: each is
 * idempotent by its ULID (a repeat gets the stored result with `200`), needs a token bound
 * to the shift's tablet, and is never rejected for a business rule (problems are flagged).
 * The reads return each shift with its live report.
 */
class ShiftController extends Controller
{
    /**
     * Relations the Shift resource reads.
     */
    public const RESOURCE_RELATIONS = ['device', 'opener', 'closer'];

    public function __construct(private readonly BuildShiftReports $buildReports) {}

    /**
     * GET /api/v1/shifts (`report.zread`)
     *
     * The branch's shifts, newest first (opened_at, then id, descending), cursor-paginated,
     * each with its report (computed for the whole page at once).
     */
    public function index(ListShiftsRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Shift::class);

        $caller = $this->actor($request);
        $businessDate = $request->validated('business_date');
        $deviceId = $request->integerFilter('device_id');
        $status = $request->validated('status');

        $shifts = Shift::query()
            ->where('branch_id', $caller->branch_id)
            ->with(self::RESOURCE_RELATIONS)
            ->when($businessDate !== null, function ($query) use ($caller, $businessDate) {
                $range = BusinessDay::forBranch($caller->branch)->range($businessDate);

                $query->where('opened_at', '>=', $range['start'])->where('opened_at', '<', $range['end']);
            })
            ->when($deviceId !== null, fn ($query) => $query->where('device_id', $deviceId))
            ->when($status === Shift::STATUS_OPEN, fn ($query) => $query->whereNull('closed_at'))
            ->when($status === Shift::STATUS_CLOSED, fn ($query) => $query->whereNotNull('closed_at'))
            ->orderByDesc('opened_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        $this->buildReports->execute($shifts->items());

        return ShiftResource::collection($shifts);
    }

    /**
     * POST /api/v1/shifts (`shift.open`)
     *
     * 201 with the new shift; 200 with the stored shift on a repeat.
     */
    public function store(StoreShiftRequest $request, OpenShiftAction $openShift): JsonResponse
    {
        $this->authorize('open', Shift::class);

        $result = $openShift->execute($this->actor($request), $request->device(), $request->validated(), $request->ip());

        /** @var Shift $shift */
        $shift = $result->record;

        return $this->shiftResource($shift)
            ->response()
            ->setStatusCode($result->created ? 201 : 200);
    }

    /**
     * GET /api/v1/shifts/{ulid} (`report.zread`, or a shift of the caller's own tablet)
     *
     * 404 for a shift the caller's branch doesn't know.
     */
    public function show(Request $request, string $ulid): ShiftResource
    {
        $caller = $this->actor($request);

        $shift = Shift::query()
            ->where('branch_id', $caller->branch_id)
            ->where('ulid', strtoupper($ulid))
            ->firstOrFail();

        $this->authorize('view', [$shift, Device::ofSession($caller)]);

        return $this->shiftResource($shift);
    }

    /**
     * POST /api/v1/shifts/{ulid}/cash-movements (`shift.open`)
     *
     * 201 with the new movement; 200 with the stored movement on a repeat.
     */
    public function storeCashMovement(StoreCashMovementRequest $request, RecordCashMovementAction $recordMovement): JsonResponse
    {
        $shift = $request->shift();

        $this->authorize('recordCashMovement', $shift);

        $result = $recordMovement->execute($shift, $request->validated(), $request->ip());

        return (new CashMovementResource($result->record))
            ->response()
            ->setStatusCode($result->created ? 201 : 200);
    }

    /**
     * POST /api/v1/shifts/{ulid}/close (`shift.close`)
     *
     * Always 200: the closed shift, or the stored one when it was already closed.
     */
    public function close(CloseShiftRequest $request, CloseShiftAction $closeShift): JsonResponse
    {
        $shift = $request->shift();

        $this->authorize('close', $shift);

        return $this->shiftResource($closeShift->execute($shift, $request->validated(), $request->ip()))
            ->response()
            ->setStatusCode(200);
    }

    /**
     * GET /api/v1/shifts/current (any authenticated user; Q-035)
     *
     * The open shift of the token's device in the caller's branch, or `data: null`. 409
     * "Register this tablet first." when the token isn't bound to a device.
     */
    public function current(Request $request): CurrentShiftResource
    {
        $caller = $this->actor($request);
        $device = Device::ofSession($caller) ?? throw new ConflictException(SyncOrdersRequest::MESSAGE_NO_DEVICE);

        $shift = Shift::query()
            ->where('branch_id', $caller->branch_id)
            ->where('device_id', $device->id)
            ->whereNull('closed_at')
            ->orderByDesc('opened_at')
            ->orderByDesc('id')
            ->first();

        if ($shift === null) {
            return new CurrentShiftResource(null);
        }

        $this->authorize('view', [$shift, $device]);

        $shift->load(self::RESOURCE_RELATIONS);
        $this->buildReports->execute([$shift]);

        return new CurrentShiftResource($shift);
    }

    private function shiftResource(Shift $shift): ShiftResource
    {
        $shift->load(self::RESOURCE_RELATIONS);
        $this->buildReports->execute([$shift]);

        return new ShiftResource($shift);
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
