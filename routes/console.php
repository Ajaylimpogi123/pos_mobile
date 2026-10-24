<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Expired API tokens no longer authenticate; remove them from the table daily.
Schedule::command('sanctum:prune-expired --hours=24')->daily();

// Web POS print jobs that printed or failed more than 30 days ago (Web POS & Print Bridge → E).
Schedule::command('print-jobs:prune')->daily();

// Error-log events received more than 90 days ago, then the groups left without events
// (Hardening & Pilot → B).
Schedule::command('error-log:prune')->daily();
