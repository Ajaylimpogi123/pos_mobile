<?php

namespace App\Actions\Auth;

use App\Actions\Audit\RecordAuditLog;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Revokes only the token used for the current request.
 */
class LogoutAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(User $user, PersonalAccessToken $token, ?string $ip = null): void
    {
        DB::transaction(function () use ($user, $token, $ip): void {
            $this->recordAuditLog->execute(
                action: 'auth.logout',
                actor: $user,
                subject: $user,
                changes: ['token_id' => $token->getKey(), 'token_name' => $token->name],
                ip: $ip,
            );

            $token->delete();
        });
    }
}
