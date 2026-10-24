<?php

namespace App\Actions\Errors;

use App\Actions\Audit\RecordAuditLog;
use App\Models\ErrorGroup;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/admin/error-log/{group}/reopen (Hardening & Pilot → B, `system.manage`):
 * reopens a resolved group (clears `resolved_at` and `resolved_by`) and audits
 * `error.reopened`. An open group stays as it is (no audit entry).
 */
class ReopenErrorGroupAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(ErrorGroup $group, User $actor, ?string $ip): ErrorGroup
    {
        return DB::transaction(function () use ($group, $actor, $ip): ErrorGroup {
            /** @var ErrorGroup $locked */
            $locked = ErrorGroup::query()->whereKey($group->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== ErrorGroup::STATUS_OPEN) {
                $locked->forceFill([
                    'status' => ErrorGroup::STATUS_OPEN,
                    'resolved_at' => null,
                    'resolved_by' => null,
                ])->save();

                $this->recordAuditLog->execute(
                    action: 'error.reopened',
                    actor: $actor,
                    subject: $locked,
                    changes: ['source' => $locked->source, 'level' => $locked->level, 'message' => mb_substr($locked->message, 0, 200)],
                    ip: $ip,
                );
            }

            return $group->setRawAttributes($locked->getAttributes(), true)->unsetRelation('resolver');
        });
    }
}
