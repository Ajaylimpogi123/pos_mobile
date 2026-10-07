<?php

namespace App\Actions\Sales;

use App\Actions\Auth\VerifyPin;
use App\Exceptions\PinLockedException;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Manager approval of a void or a refund (Phase 7 contract, *Permissions*), the same pattern
 * as discount approval (ApproveDiscount).
 *
 * - **Own authority:** a caller holding the permission (`sale.void` / `sale.refund`) needs no
 *   approval; `authorization` is then ignored (its PIN is not checked) and there is no
 *   approver.
 * - **Otherwise** the request carries `authorization: { user_id, pin }`. The approver must be
 *   active, non-deleted, in the caller's branch, have a PIN and hold the permission. The PIN
 *   goes through the shared PIN-attempt limiter (VerifyPin): 5 wrong PINs lock it for 15
 *   minutes (`429`).
 *
 * Errors: `422` on `authorization` (`A manager must approve this void.` / `… refund.`), on
 * `authorization.user_id` (`This person can't approve voids.` / `… refunds.`), on
 * `authorization.pin` (`Incorrect PIN.`), and `429` while the approver's PIN is locked.
 */
class ApproveReversal
{
    public const VOID = 'sale.void';

    public const REFUND = 'sale.refund';

    public const MESSAGE_VOID_REQUIRED = 'A manager must approve this void.';

    public const MESSAGE_REFUND_REQUIRED = 'A manager must approve this refund.';

    public const MESSAGE_VOID_NOT_APPROVER = "This person can't approve voids.";

    public const MESSAGE_REFUND_NOT_APPROVER = "This person can't approve refunds.";

    public function __construct(private readonly VerifyPin $verifyPin) {}

    /**
     * Call it outside any DB transaction (the PIN attempt must stay counted).
     *
     * @param  self::VOID|self::REFUND  $permission
     * @param  array{user_id?: mixed, pin?: mixed}|null  $authorization  The validated `authorization`
     * @return User|null The approver when a PIN approval was used, else null
     *
     * @throws ValidationException 422 on `authorization`, `.user_id` or `.pin`
     * @throws PinLockedException 429
     */
    public function execute(User $caller, string $permission, ?array $authorization): ?User
    {
        [$required, $notApprover] = match ($permission) {
            self::VOID => [self::MESSAGE_VOID_REQUIRED, self::MESSAGE_VOID_NOT_APPROVER],
            self::REFUND => [self::MESSAGE_REFUND_REQUIRED, self::MESSAGE_REFUND_NOT_APPROVER],
            default => throw new InvalidArgumentException("Unknown reversal permission [{$permission}]."),
        };

        if ($caller->hasPermission($permission)) {
            return null;
        }

        if ($authorization === null) {
            throw ValidationException::withMessages(['authorization' => $required]);
        }

        // Soft-deleted users are excluded by the SoftDeletes scope.
        $approver = User::query()
            ->with('role.permissions')
            ->whereKey((int) $authorization['user_id'])
            ->where('branch_id', $caller->branch_id)
            ->where('is_active', true)
            ->whereNotNull('pin_hash')
            ->first();

        if ($approver === null || ! $approver->hasPermission($permission)) {
            throw ValidationException::withMessages(['authorization.user_id' => $notApprover]);
        }

        $this->verifyPin->execute($approver, (string) $authorization['pin'], 'authorization.pin');

        return $approver;
    }
}
