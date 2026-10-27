<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Reservations\CancelReservationAction;
use App\Actions\Reservations\CreateReservationAction;
use App\Actions\Reservations\MarkReservationNoShowAction;
use App\Actions\Reservations\UpdateReservationAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Reservations\CancelReservationRequest;
use App\Http\Requests\Reservations\ListReservationsRequest;
use App\Http\Requests\Reservations\NoShowReservationRequest;
use App\Http\Requests\Reservations\StoreReservationRequest;
use App\Http\Requests\Reservations\UpdateReservationRequest;
use App\Http\Resources\ReservationResource;
use App\Models\Branch;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\BranchSettings;
use App\Support\BusinessDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Reservations (Table Management → E, TM2; `sale.create`; online only). Every mutation is
 * idempotent (`Idempotency-Key`). While dine-in is off every endpoint is a `409`; a
 * reservation of another branch, or an unknown one, is a `404`. Seating happens through
 * POST /tabs (`reservation_ulid`).
 */
class ReservationController extends Controller
{
    /**
     * GET /api/v1/reservations
     *
     * One business day's reservations (default today), optionally by `status` and
     * `table_id`, ordered by `reserved_for`, then `id`, cursor-paginated (default 100).
     */
    public function index(ListReservationsRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', TableReservation::class);

        $branch = $this->branch($request->user());
        $hold = BranchSettings::for($branch)->reservationHoldMinutes();
        $tableId = $request->integerFilter('table_id');
        $status = $request->status();

        $reservations = TableReservation::query()
            ->with(TableReservation::RESOURCE_RELATIONS)
            ->where('branch_id', $branch->id)
            ->where('business_date', $request->businessDate() ?? BusinessDay::forBranch($branch)->dateOf(now()))
            ->when($status !== null, fn ($query) => $query->where('status', $status))
            ->when($tableId !== null, fn ($query) => $query->where('table_id', $tableId))
            ->orderBy('reserved_for')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString()
            ->through(fn (TableReservation $reservation) => $reservation->withHoldMinutes($hold));

        return ReservationResource::collection($reservations);
    }

    /**
     * POST /api/v1/reservations (idempotent: `Idempotency-Key` = the body's `ulid`)
     */
    public function store(StoreReservationRequest $request, CreateReservationAction $create): JsonResponse
    {
        $this->authorize('create', TableReservation::class);

        /** @var User $caller */
        $caller = $request->user();

        return (new ReservationResource($create->execute($caller, $request->validated(), $request->ip())))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * PATCH /api/v1/reservations/{ulid} (idempotent)
     */
    public function update(UpdateReservationRequest $request, UpdateReservationAction $update): ReservationResource
    {
        $this->authorize('update', $request->reservation());

        return new ReservationResource($update->execute($request->reservation(), $request->validated(), $request->actor(), $request->ip()));
    }

    /**
     * POST /api/v1/reservations/{ulid}/cancel (idempotent)
     */
    public function cancel(CancelReservationRequest $request, CancelReservationAction $cancel): ReservationResource
    {
        $this->authorize('update', $request->reservation());

        $reason = $request->validated('reason');

        return new ReservationResource($cancel->execute(
            $request->reservation(),
            $reason === null ? null : (string) $reason,
            $request->actor(),
            $request->ip(),
        ));
    }

    /**
     * POST /api/v1/reservations/{ulid}/no-show (idempotent)
     */
    public function noShow(NoShowReservationRequest $request, MarkReservationNoShowAction $noShow): ReservationResource
    {
        $this->authorize('update', $request->reservation());

        return new ReservationResource($noShow->execute($request->reservation(), $request->actor(), $request->ip()));
    }

    private function branch(?User $caller): Branch
    {
        return Branch::query()->findOrFail($caller?->branch_id);
    }
}
