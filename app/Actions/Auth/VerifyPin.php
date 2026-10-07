<?php

namespace App\Actions\Auth;

use App\Exceptions\PinLockedException;
use App\Models\User;
use App\Support\PinAttemptLimiter;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Checks a PIN against its owner's `pin_hash` through the shared PIN-attempt limiter,
 * for the PIN switch and for discount approval: a locked PIN is a 429 (even when the
 * PIN is right), a wrong PIN counts as an attempt and is a 422 on the given field, and
 * a correct PIN resets the counter. The PIN is never logged, stored or echoed.
 *
 * Call it outside any DB transaction (see PinAttemptLimiter).
 */
class VerifyPin
{
    public const MESSAGE_INCORRECT = 'Incorrect PIN.';

    public function __construct(private readonly PinAttemptLimiter $attempts) {}

    /**
     * @param  string  $field  The request field the 422 is reported on, e.g. `pin`
     *
     * @throws PinLockedException 429 while the owner's PIN is locked
     * @throws ValidationException 422 on `$field` for a wrong PIN
     */
    public function execute(User $owner, string $pin, string $field): void
    {
        $this->attempts->ensureNotLocked($owner);

        if ($owner->pin_hash === null || ! Hash::check($pin, $owner->pin_hash)) {
            $this->attempts->recordFailure($owner);

            throw ValidationException::withMessages([$field => self::MESSAGE_INCORRECT]);
        }

        $this->attempts->reset($owner);
    }
}
