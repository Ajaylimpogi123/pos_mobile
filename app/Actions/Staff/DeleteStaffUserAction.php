<?php

namespace App\Actions\Staff;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a staff account, revokes all of its tokens at once, and writes a
 * `user.deleted` audit entry. You cannot delete yourself (409).
 */
class DeleteStaffUserAction
{
    public const MESSAGE_DELETE_SELF = 'You cannot delete your own account.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ConflictException 409 when deleting your own account
     */
    public function execute(User $target, User $actor, ?string $ip = null): void
    {
        if ($target->is($actor)) {
            throw new ConflictException(self::MESSAGE_DELETE_SELF);
        }

        DB::transaction(function () use ($target, $actor, $ip): void {
            $target->forceFill(['updated_by' => $actor->id])->save();
            $target->delete();
            $target->revokeApiTokens();

            $this->recordAuditLog->execute(
                action: 'user.deleted',
                actor: $actor,
                subject: $target,
                changes: ['name' => $target->name, 'email' => $target->email],
                ip: $ip,
            );
        });
    }
}
