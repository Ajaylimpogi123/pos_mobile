<?php

namespace App\Actions\Printing;

use App\Models\PrintJob;

/**
 * The outcome of POST /print-jobs: the job, and whether this request created it (`201`)
 * or found it, as a replay or a first-print duplicate (`200`).
 */
final class PrintJobResult
{
    private function __construct(
        public readonly PrintJob $job,
        public readonly bool $created,
    ) {}

    public static function created(PrintJob $job): self
    {
        return new self($job, true);
    }

    public static function existing(PrintJob $job): self
    {
        return new self($job, false);
    }
}
