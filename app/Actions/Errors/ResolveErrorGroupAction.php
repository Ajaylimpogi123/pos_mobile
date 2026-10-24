<?php

namespace App\Actions\Errors;

use App\Actions\Audit\RecordAuditLog;
use App\Models\ErrorGroup;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/admin/error-log/{group}/resolve (Hardening & Pilot → B, `system.manage`):
 * marks the group resolved (`resolved_at`, `resolved_by`) and audits `error.resolved`. A
 * resolved group stays as it is (no second audit entry). A new occurrence reopens it.
 */
class ResolveErrorGroupAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(ErrorGroup $group, User $actor, ?string $ip): ErrorGroup
    {
        return DB::transaction(function () use ($group, $actor, $ip): ErrorGroup {
            /** @var ErrorGroup $locked */
            $locked = ErrorGroup::query()->whereKey($group->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== ErrorGroup::STATUS_RESOLVED) {
                $locked->forceFill([
                    'status' => ErrorGroup::STATUS_RESOLVED,
                    'resolved_at' => CarbonImmutable::now(),
                    'resolved_by' => $actor->id,
                ])->save();

                $this->recordAuditLog->execute(
                    action: 'error.resolved',
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
