<?php

namespace App\Actions\Printing;

use App\Exceptions\ConflictException;
use App\Models\PrintJob;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/print-agent/jobs/{ulid}/result (Web POS & Print Bridge → E). The job must be
 * `printing` and claimed by this agent (otherwise 409); an unknown ULID in the agent's
 * branch is a 404.
 *
 * - `printed` → `printed`, with `printed_at` now (and `last_error` cleared);
 * - `failed` with `retryable` and `attempts < 3` → back to `queued` (the claim is released;
 *   `last_error` keeps the reason);
 * - otherwise `failed`, with `last_error`.
 */
class RecordPrintJobResultAction
{
    public const MESSAGE_NOT_CLAIMED = 'This job is not claimed by this agent.';

    /**
     * @param  array{agent_id: string, status: string, error?: string|null, retryable?: bool|int|string}  $data
     *
     * @throws ConflictException 409 when the job isn't `printing` for this agent
     */
    public function execute(int $branchId, string $ulid, array $data): PrintJob
    {
        return DB::transaction(function () use ($branchId, $ulid, $data): PrintJob {
            /** @var PrintJob $job */
            $job = PrintJob::query()
                ->select(PrintJob::SUMMARY_COLUMNS)
                ->where('branch_id', $branchId)
                ->where('ulid', strtoupper($ulid))
                ->lockForUpdate()
                ->firstOrFail();

            if ($job->status !== PrintJob::STATUS_PRINTING || $job->claimed_by !== $data['agent_id']) {
                throw new ConflictException(self::MESSAGE_NOT_CLAIMED);
            }

            $error = $data['error'] ?? null;
            $retryable = filter_var($data['retryable'] ?? false, FILTER_VALIDATE_BOOLEAN);

            if ($data['status'] === PrintJob::STATUS_PRINTED) {
                $job->forceFill([
                    'status' => PrintJob::STATUS_PRINTED,
                    'printed_at' => now(),
                    'last_error' => null,
                ]);
            } elseif ($retryable && $job->attempts < PrintJob::MAX_ATTEMPTS) {
                $job->forceFill([
                    'status' => PrintJob::STATUS_QUEUED,
                    'claimed_by' => null,
                    'claimed_at' => null,
                    'last_error' => $error,
                ]);
            } else {
                $job->forceFill([
                    'status' => PrintJob::STATUS_FAILED,
                    'last_error' => $error,
                ]);
            }

            $job->save();

            return $job;
        });
    }
}
