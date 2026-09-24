<?php

namespace App\Actions\Audit;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Appends one entry to the audit trail.
 */
class RecordAuditLog
{
    /**
     * @param  array<string, mixed>|null  $changes
     */
    public function execute(
        string $action,
        ?User $actor = null,
        ?Model $subject = null,
        ?array $changes = null,
        ?string $ip = null,
    ): AuditLog {
        return AuditLog::create([
            'actor_id' => $actor?->getKey(),
            'action' => $action,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'changes' => $changes,
            'ip' => $ip,
        ]);
    }
}
