<?php

namespace App\Actions\Auth;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\PinLockedException;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The PIN quick-switch (POST /api/v1/auth/pin): one device, many staff. Checks run in
 * the contract's order and the first failure wins:
 *
 * 1. The target must be an active, non-deleted user of the caller's branch with a PIN,
 *    else 422 on `user_id`.
 * 2. The target's PIN must not be locked (429), and must be correct (422 on `pin`, which
 *    counts as an attempt). See VerifyPin and the shared PinAttemptLimiter.
 *
 * On success, in one transaction: a new `mobile-app` token for the target (exactly as
 * login issues it, including `last_login_at`), the token that made the request is
 * revoked, and `auth.pin_switch` is written (actor = the target). Switching to yourself
 * simply renews the token.
 */
class PinSwitchAction
{
    public const MESSAGE_NOT_SWITCHABLE = "This person can't sign in with a PIN.";

    public function __construct(
        private readonly VerifyPin $verifyPin,
        private readonly IssueSessionToken $issueSessionToken,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @throws ValidationException 422 on `user_id` or `pin`
     * @throws PinLockedException 429
     */
    public function execute(
        User $caller,
        PersonalAccessToken $currentToken,
        int $targetId,
        string $pin,
        ?string $ip = null,
    ): LoginResult {
        // Soft-deleted users are excluded by the SoftDeletes scope.
        $target = User::query()
            ->whereKey($targetId)
            ->where('branch_id', $caller->branch_id)
            ->where('is_active', true)
            ->whereNotNull('pin_hash')
            ->first();

        if ($target === null) {
            throw ValidationException::withMessages(['user_id' => self::MESSAGE_NOT_SWITCHABLE]);
        }

        // Outside the transaction: a failed attempt must stay counted.
        $this->verifyPin->execute($target, $pin, 'pin');

        return DB::transaction(function () use ($caller, $currentToken, $target, $ip): LoginResult {
            $token = $this->issueSessionToken->execute($target);

            $currentToken->delete();

            $this->recordAuditLog->execute(
                action: 'auth.pin_switch',
                actor: $target,
                subject: $target,
                changes: ['from_user_id' => $caller->id],
                ip: $ip,
            );

            return new LoginResult($target, $token);
        });
    }
}
