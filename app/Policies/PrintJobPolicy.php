<?php

namespace App\Policies;

use App\Models\PrintJob;
use App\Models\User;

/**
 * Print jobs of the web terminals (Web POS & Print Bridge → D). Any signed-in user may
 * queue, read and retry the prints of their own branch (like printing on a tablet, which
 * needs no permission). Creating also needs a token bound to a device, checked by the
 * request. The print agent's endpoints are machine endpoints, guarded by its token.
 */
class PrintJobPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function retry(User $user, PrintJob $printJob): bool
    {
        return $printJob->branch_id === (int) $user->branch_id;
    }
}
