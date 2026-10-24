<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Printing\CreatePrintJobAction;
use App\Actions\Printing\RetryPrintJobAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Printing\ListPrintJobsRequest;
use App\Http\Requests\Printing\StorePrintJobRequest;
use App\Http\Resources\PrintJobResource;
use App\Models\PrintJob;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Print jobs of the web terminals (Web POS & Print Bridge → D), branch-scoped: the browser
 * queues prebuilt ESC/POS bytes, polls their status and retries a failed print. The print
 * agent sends them (PrintAgentController).
 */
class PrintJobController extends Controller
{
    /**
     * GET /api/v1/print-jobs?ulids[]=… (any authenticated user)
     *
     * The caller's branch's jobs among the given ULIDs, in no particular order; unknown
     * ULIDs are left out. Not paginated (at most 50).
     */
    public function index(ListPrintJobsRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', PrintJob::class);

        /** @var list<string> $ulids */
        $ulids = $request->validated('ulids');

        $jobs = PrintJob::query()
            ->select(PrintJob::SUMMARY_COLUMNS)
            ->with('printer')
            ->where('branch_id', $this->actor($request)->branch_id)
            ->whereIn('ulid', array_values(array_unique($ulids)))
            ->get();

        return PrintJobResource::collection($jobs);
    }

    /**
     * POST /api/v1/print-jobs (any authenticated user, from a registered terminal)
     *
     * 201 with a new job; 200 with the existing job on a replay or a first-print duplicate.
     */
    public function store(StorePrintJobRequest $request, CreatePrintJobAction $create): JsonResponse
    {
        $this->authorize('create', PrintJob::class);

        $result = $create->execute($this->actor($request), $request->device(), $request->validated(), $request->payload());

        return (new PrintJobResource($result->job))
            ->response()
            ->setStatusCode($result->created ? 201 : 200);
    }

    /**
     * POST /api/v1/print-jobs/{ulid}/retry (any authenticated user)
     *
     * 200 with the re-queued job; 409 unless it is `failed`; 404 outside the caller's branch.
     */
    public function retry(Request $request, string $ulid, RetryPrintJobAction $retry): PrintJobResource
    {
        $job = PrintJob::query()
            ->select(PrintJob::SUMMARY_COLUMNS)
            ->where('branch_id', $this->actor($request)->branch_id)
            ->where('ulid', strtoupper($ulid))
            ->firstOrFail();

        $this->authorize('retry', $job);

        return new PrintJobResource($retry->execute($job));
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
