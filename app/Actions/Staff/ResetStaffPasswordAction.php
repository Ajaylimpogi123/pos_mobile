<?php

namespace App\Actions\Staff;

use App\Actions\Audit\RecordAuditLog;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Sets a new password and revokes all of the user's tokens at once. When you reset
 * your own password, your current token is kept and your others are revoked.
 * Writes a `user.password_reset` audit entry, never with the password.
 */
class ResetStaffPasswordAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(User $target, string $password, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($target, $password, $actor, $ip): void {
            // The `hashed` cast hashes the plain-text value on assignment.
            $target->forceFill(['password' => $password, 'updated_by' => $actor->id])->save();

            $keepTokenId = $target->is($actor) ? $actor->currentAccessToken()?->getKey() : null;

            $revoked = $target->revokeApiTokens($keepTokenId);

            $this->recordAuditLog->execute(
                action: 'user.password_reset',
                actor: $actor,
                subject: $target,
                changes: ['revoked_tokens' => $revoked],
                ip: $ip,
            );
        });
    }
}
