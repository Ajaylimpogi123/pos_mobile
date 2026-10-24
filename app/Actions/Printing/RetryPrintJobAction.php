<?php

namespace App\Actions\Printing;

use App\Exceptions\ConflictException;
use App\Models\PrintJob;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/print-jobs/{ulid}/retry (Web POS & Print Bridge → D): a `failed` job goes
 * back to the queue with `attempts` reset to 0 and `last_error` cleared. Any other status
 * → 409.
 */
class RetryPrintJobAction
{
    public const MESSAGE_NOT_FAILED = 'Only a failed print can be retried.';

    /**
     * @throws ConflictException 409 when the job isn't `failed`
     */
    public function execute(PrintJob $job): PrintJob
    {
        return DB::transaction(function () use ($job): PrintJob {
            /** @var PrintJob $locked */
            $locked = PrintJob::query()
                ->select(PrintJob::SUMMARY_COLUMNS)
                ->whereKey($job->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($locked->status !== PrintJob::STATUS_FAILED) {
                throw new ConflictException(self::MESSAGE_NOT_FAILED);
            }

            $locked->forceFill([
                'status' => PrintJob::STATUS_QUEUED,
                'attempts' => 0,
                'last_error' => null,
                'claimed_by' => null,
                'claimed_at' => null,
            ])->save();

            return $locked->load('printer');
        });
    }
}
