<?php

namespace App\Support;

use App\Exceptions\PinLockedException;
use App\Models\User;
use Illuminate\Cache\RateLimiter;

/**
 * The shared PIN-attempt limiter (Phase 3 contract, *PIN attempts*), used by the PIN
 * switch and by discount approval: 5 incorrect PINs for the same PIN **owner** within
 * 15 minutes lock that owner's PIN until the window ends. A correct PIN resets it.
 *
 * Unlike the `login` limiter (AppServiceProvider), this cannot be route throttling:
 * only incorrect PINs count, and the key is the PIN owner from the request body.
 *
 * The counter lives in the default cache store, which may be the `database` store on
 * the default connection. Record attempts **outside** any DB transaction, or a rollback
 * of the failed request would also roll the attempt back.
 */
final class PinAttemptLimiter
{
    public const MAX_ATTEMPTS = 5;

    public const DECAY_SECONDS = 15 * 60;

    public function __construct(private readonly RateLimiter $limiter) {}

    /**
     * @throws PinLockedException 429 while the owner's PIN is locked
     */
    public function ensureNotLocked(User $owner): void
    {
        $key = $this->key($owner);

        if ($this->limiter->tooManyAttempts($key, self::MAX_ATTEMPTS)) {
            throw new PinLockedException($this->limiter->availableIn($key));
        }
    }

    /**
     * Count one incorrect PIN. The first failure opens the 15-minute window.
     */
    public function recordFailure(User $owner): void
    {
        $this->limiter->hit($this->key($owner), self::DECAY_SECONDS);
    }

    /**
     * A correct PIN resets the counter.
     */
    public function reset(User $owner): void
    {
        $this->limiter->clear($this->key($owner));
    }

    private function key(User $owner): string
    {
        return 'pin-attempts:'.$owner->getKey();
    }
}
