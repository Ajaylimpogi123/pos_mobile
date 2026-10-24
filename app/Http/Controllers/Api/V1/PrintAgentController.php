<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Printing\ClaimPrintJobsAction;
use App\Actions\Printing\RecordPrintJobResultAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\PrintAgent\ClaimPrintJobsRequest;
use App\Http\Requests\PrintAgent\ReportPrintJobResultRequest;
use App\Http\Resources\AgentJobResource;
use App\Http\Resources\PrintAgentPingResource;
use App\Http\Resources\PrintJobResultResource;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The print agent's machine endpoints (Web POS & Print Bridge → E). No Sanctum: every
 * request is authorized by its `X-Print-Agent-Token` (EnsurePrintAgentToken). The agent
 * serves the one branch `PRINT_AGENT_BRANCH_ID`.
 */
class PrintAgentController extends Controller
{
    /**
     * GET /api/v1/print-agent/ping
     */
    public function ping(): PrintAgentPingResource
    {
        return new PrintAgentPingResource(now());
    }

    /**
     * POST /api/v1/print-agent/jobs/claim
     *
     * Up to `limit` (default 10) of the branch's oldest claimable jobs, now `printing`.
     */
    public function claim(ClaimPrintJobsRequest $request, ClaimPrintJobsAction $claim): AnonymousResourceCollection
    {
        $jobs = $claim->execute($this->branchId(), (string) $request->validated('agent_id'), $request->limit());

        return AgentJobResource::collection($jobs);
    }

    /**
     * POST /api/v1/print-agent/jobs/{ulid}/result
     *
     * 200 with the job's new status; 409 when it isn't claimed by this agent; 404 when unknown.
     */
    public function result(ReportPrintJobResultRequest $request, string $ulid, RecordPrintJobResultAction $record): PrintJobResultResource
    {
        return new PrintJobResultResource($record->execute($this->branchId(), $ulid, $request->validated()));
    }

    private function branchId(): int
    {
        return (int) config('pos.print_agent.branch_id');
    }
}
