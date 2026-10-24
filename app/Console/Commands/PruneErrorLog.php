<?php

namespace App\Console\Commands;

use App\Actions\Errors\PruneErrorLogAction;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Deletes the error-log events received more than 90 days ago, then the groups left without
 * events (Hardening & Pilot → B). Scheduled daily in routes/console.php.
 */
#[Signature('error-log:prune')]
#[Description('Delete error-log events older than 90 days and the groups left without events')]
class PruneErrorLog extends Command
{
    public function handle(PruneErrorLogAction $prune): int
    {
        $deleted = $prune->execute();

        $this->info("Deleted {$deleted['events']} error event(s) and {$deleted['groups']} error group(s).");

        return self::SUCCESS;
    }
}
