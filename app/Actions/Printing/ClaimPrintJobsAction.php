<?php

namespace App\Actions\Printing;

use App\Models\Printer;
use App\Models\PrintJob;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/print-agent/jobs/claim (Web POS & Print Bridge → E). In one transaction,
 * with `SELECT … FOR UPDATE SKIP LOCKED` (so two agents never take the same job):
 *
 * - takes the branch's oldest jobs (by id) that are `queued`, or `printing` with a claim
 *   older than 60 s (a crashed agent);
 * - a job whose printer is now disabled or deleted becomes `failed` ("The printer is
 *   disabled.") and is not returned;
 * - a stale `printing` job that already has 3 attempts becomes `failed` ("The print agent
 *   stopped responding.", claim cleared) and is not returned (Q-034 #6);
 * - the others become `printing`, claimed by the agent now, with `attempts + 1`, and are
 *   returned with their printer as it is now (host and port read at claim time).
 */
class ClaimPrintJobsAction
{
    public const MESSAGE_PRINTER_DISABLED = 'The printer is disabled.';

    public const MESSAGE_AGENT_STOPPED = 'The print agent stopped responding.';

    /**
     * @return Collection<int, PrintJob> the claimed jobs, oldest first, with `printer` loaded
     */
    public function execute(int $branchId, string $agentId, int $limit): Collection
    {
        return DB::transaction(function () use ($branchId, $agentId, $limit): Collection {
            $now = now();
            $staleBefore = $now->copy()->subSeconds(PrintJob::STALE_CLAIM_SECONDS);

            $jobs = PrintJob::query()
                ->where('branch_id', $branchId)
                ->where(fn ($query) => $query
                    ->where('status', PrintJob::STATUS_QUEUED)
                    ->orWhere(fn ($query) => $query
                        ->where('status', PrintJob::STATUS_PRINTING)
                        ->where('claimed_at', '<', $staleBefore)))
                ->orderBy('id')
                ->limit($limit)
                ->lock('for update skip locked')
                ->get();

            if ($jobs->isEmpty()) {
                return $jobs;
            }

            $printers = Printer::withTrashed()
                ->whereKey($jobs->pluck('printer_id')->unique()->all())
                ->get()
                ->keyBy('id');

            return $jobs->filter(function (PrintJob $job) use ($printers, $agentId, $now): bool {
                /** @var Printer|null $printer */
                $printer = $printers->get($job->printer_id);

                if ($printer === null || $printer->trashed() || ! $printer->is_enabled) {
                    $job->forceFill([
                        'status' => PrintJob::STATUS_FAILED,
                        'last_error' => self::MESSAGE_PRINTER_DISABLED,
                        'claimed_by' => null,
                        'claimed_at' => null,
                    ])->save();

                    return false;
                }

                // A stale claim that already used every attempt: the agent keeps dying on it (Q-034 #6).
                if ($job->status === PrintJob::STATUS_PRINTING && $job->attempts >= PrintJob::MAX_ATTEMPTS) {
                    $job->forceFill([
                        'status' => PrintJob::STATUS_FAILED,
                        'last_error' => self::MESSAGE_AGENT_STOPPED,
                        'claimed_by' => null,
                        'claimed_at' => null,
                    ])->save();

                    return false;
                }

                $job->forceFill([
                    'status' => PrintJob::STATUS_PRINTING,
                    'claimed_by' => $agentId,
                    'claimed_at' => $now,
                    // The column is a TINYINT UNSIGNED; a job reclaimed endlessly stops counting.
                    'attempts' => min($job->attempts + 1, 255),
                ])->save();

                $job->setRelation('printer', $printer);

                return true;
            })->values();
        });
    }
}
