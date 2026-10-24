<?php

namespace App\Actions\Printing;

use App\Models\PrintJob;

/**
 * `php artisan print-jobs:prune` (Web POS & Print Bridge → E): deletes the `printed` and
 * `failed` jobs created more than 30 days ago, in every branch, in batches so no large
 * lock is held. Queued and printing jobs are never pruned.
 */
class PrunePrintJobsAction
{
    public const KEEP_DAYS = 30;

    private const BATCH = 1000;

    /**
     * @return int the number of deleted jobs
     */
    public function execute(): int
    {
        $before = now()->subDays(self::KEEP_DAYS);
        $deleted = 0;

        do {
            $count = PrintJob::query()
                ->whereIn('status', [PrintJob::STATUS_PRINTED, PrintJob::STATUS_FAILED])
                ->where('created_at', '<', $before)
                ->orderBy('id')
                ->limit(self::BATCH)
                ->delete();

            $deleted += $count;
        } while ($count === self::BATCH);

        return $deleted;
    }
}
