<?php

namespace App\Console\Commands;

use App\Actions\Printing\PrunePrintJobsAction;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Deletes the web POS print jobs that printed or failed more than 30 days ago (Web POS &
 * Print Bridge → E). Scheduled daily in routes/console.php.
 */
#[Signature('print-jobs:prune')]
#[Description('Delete printed and failed print jobs older than 30 days')]
class PrunePrintJobs extends Command
{
    public function handle(PrunePrintJobsAction $prune): int
    {
        $deleted = $prune->execute();

        $this->info("Deleted {$deleted} print job(s).");

        return self::SUCCESS;
    }
}
