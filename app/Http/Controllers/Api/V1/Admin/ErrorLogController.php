<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Errors\ErrorLogQuery;
use App\Actions\Errors\ReopenErrorGroupAction;
use App\Actions\Errors\ResolveErrorGroupAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\System\ListErrorLogRequest;
use App\Http\Resources\ErrorGroupResource;
use App\Models\ErrorGroup;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The error log (Hardening & Pilot → B; permission `system.manage`). `{errorGroup}` resolves
 * only to a group the caller can see (AppServiceProvider + ErrorLogQuery), otherwise 404.
 */
class ErrorLogController extends Controller
{
    public function __construct(private readonly ErrorLogQuery $errorLog) {}

    /**
     * GET /api/v1/admin/error-log
     *
     * Groups by `last_seen_at` desc, with `meta.summary`.
     */
    public function index(ListErrorLogRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', ErrorGroup::class);

        $caller = $this->actor($request);

        return ErrorGroupResource::collection($this->errorLog->paginate($caller, $request->filters(), $request->perPage()))
            ->additional(['meta' => ['summary' => $this->errorLog->summary($caller)]]);
    }

    /**
     * GET /api/v1/admin/error-log/{errorGroup}
     *
     * The group plus its latest 50 events.
     */
    public function show(Request $request, ErrorGroup $errorGroup): ErrorGroupResource
    {
        $this->authorize('view', $errorGroup);

        return new ErrorGroupResource($this->errorLog->loadDetail($this->actor($request), $errorGroup));
    }

    /**
     * POST /api/v1/admin/error-log/{errorGroup}/resolve
     */
    public function resolve(Request $request, ErrorGroup $errorGroup, ResolveErrorGroupAction $resolve): ErrorGroupResource
    {
        $this->authorize('resolve', $errorGroup);

        $group = $resolve->execute($errorGroup, $this->actor($request), $request->ip());
        $this->errorLog->loadSummaryRelations($this->actor($request), $group);

        return new ErrorGroupResource($group);
    }

    /**
     * POST /api/v1/admin/error-log/{errorGroup}/reopen
     */
    public function reopen(Request $request, ErrorGroup $errorGroup, ReopenErrorGroupAction $reopen): ErrorGroupResource
    {
        $this->authorize('reopen', $errorGroup);

        $group = $reopen->execute($errorGroup, $this->actor($request), $request->ip());
        $this->errorLog->loadSummaryRelations($this->actor($request), $group);

        return new ErrorGroupResource($group);
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
