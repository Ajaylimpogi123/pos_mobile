<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Tabs\CancelTabItemAction;
use App\Actions\Tabs\CloseTabAction;
use App\Actions\Tabs\MergeTabAction;
use App\Actions\Tabs\OpenTabAction;
use App\Actions\Tabs\SendRoundAction;
use App\Actions\Tabs\SettleTabAction;
use App\Actions\Tabs\TransferTabAction;
use App\Actions\Tabs\UpdateTabAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Tabs\CancelTabItemRequest;
use App\Http\Requests\Tabs\CloseTabRequest;
use App\Http\Requests\Tabs\MergeTabRequest;
use App\Http\Requests\Tabs\OpenTabRequest;
use App\Http\Requests\Tabs\SendRoundRequest;
use App\Http\Requests\Tabs\SettleTabRequest;
use App\Http\Requests\Tabs\ShowTabRequest;
use App\Http\Requests\Tabs\TransferTabRequest;
use App\Http\Requests\Tabs\UpdateTabRequest;
use App\Http\Resources\OrderResource;
use App\Http\Resources\TabResource;
use App\Models\Device;
use App\Models\Tab;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Dine-in tabs (Dine-in Tables & Tabs → D; `sale.create`; online only). Every mutation is
 * idempotent (`Idempotency-Key`). While dine-in is off every endpoint is a `409`; a tab of
 * another branch, or an unknown one, is a `404`; actions 3–9 on a tab that isn't open are a
 * `409 "This bill is already closed."`.
 */
class TabController extends Controller
{
    /**
     * POST /api/v1/tabs (idempotent: `Idempotency-Key` = the body's `ulid`)
     */
    public function store(OpenTabRequest $request, OpenTabAction $open): JsonResponse
    {
        $this->authorize('create', Tab::class);

        /** @var User $caller */
        $caller = $request->user();

        $tab = $open->execute($caller, $request->validated(), Device::ofSession($caller), $request->ip());

        return (new TabResource($tab))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/tabs/{ulid}
     */
    public function show(ShowTabRequest $request): TabResource
    {
        $this->authorize('view', $request->tab());

        return new TabResource($request->tab()->load(Tab::RESOURCE_RELATIONS));
    }

    /**
     * PATCH /api/v1/tabs/{ulid} (idempotent)
     */
    public function update(UpdateTabRequest $request, UpdateTabAction $update): TabResource
    {
        $this->authorize('update', $request->tab());

        return new TabResource($update->execute($request->tab(), $request->validated(), $request->actor(), $request->ip()));
    }

    /**
     * POST /api/v1/tabs/{ulid}/rounds (idempotent: `Idempotency-Key` = the body's `ulid`)
     *
     * 200 `{ data: Tab, round_no }`.
     */
    public function rounds(SendRoundRequest $request, SendRoundAction $sendRound): JsonResponse
    {
        $this->authorize('update', $request->tab());

        $result = $sendRound->execute($request->tab(), $request->actor(), $request->validated(), $request->ip());

        return (new TabResource($result['tab']))
            ->additional(['round_no' => $result['round_no']])
            ->response();
    }

    /**
     * POST /api/v1/tabs/{ulid}/items/{id}/cancel (idempotent)
     */
    public function cancelItem(CancelTabItemRequest $request, CancelTabItemAction $cancel): TabResource
    {
        $this->authorize('update', $request->tab());

        return new TabResource($cancel->execute(
            $request->tab(),
            $request->item(),
            $request->actor(),
            $request->validated(),
            (string) $request->header('Idempotency-Key'),
            $request->ip(),
        ));
    }

    /**
     * POST /api/v1/tabs/{ulid}/settle (idempotent: `Idempotency-Key` = the body's `ulid`)
     *
     * 201 `{ data: Order, tab: Tab }`.
     */
    public function settle(SettleTabRequest $request, SettleTabAction $settle): JsonResponse
    {
        $this->authorize('update', $request->tab());

        $caller = $request->actor();

        $result = $settle->execute(
            $request->tab(),
            $caller,
            $request->validated(),
            $request->settings()->serviceChargeBps(),
            Device::ofSession($caller),
            $request->ip(),
        );

        return (new OrderResource($result['order']))
            ->additional(['tab' => (new TabResource($result['tab']))->resolve($request)])
            ->response()
            ->setStatusCode(201);
    }

    /**
     * POST /api/v1/tabs/{ulid}/close (idempotent)
     */
    public function close(CloseTabRequest $request, CloseTabAction $close): TabResource
    {
        $this->authorize('update', $request->tab());

        return new TabResource($close->execute($request->tab(), $request->actor(), $request->ip()));
    }

    /**
     * POST /api/v1/tabs/{ulid}/transfer (T2; idempotent)
     */
    public function transfer(TransferTabRequest $request, TransferTabAction $transfer): TabResource
    {
        $this->authorize('update', $request->tab());

        return new TabResource($transfer->execute($request->tab(), (int) $request->validated('table_id'), $request->actor(), $request->ip()));
    }

    /**
     * POST /api/v1/tabs/{ulid}/merge (T2; idempotent). 200 with the target tab.
     */
    public function merge(MergeTabRequest $request, MergeTabAction $merge): TabResource
    {
        $this->authorize('update', $request->tab());

        return new TabResource($merge->execute($request->tab(), (string) $request->validated('into_ulid'), $request->actor(), $request->ip()));
    }
}
