<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A PIN owner's PIN is locked after too many incorrect attempts (Phase 3 contract,
 * *PIN attempts*). Renders `429 { "message": "Too many incorrect PIN attempts. Try again
 * in N minutes." }`, where N is the whole number of minutes left, rounded up.
 */
class PinLockedException extends RuntimeException
{
    public function __construct(public readonly int $retryAfterSeconds)
    {
        $minutes = max(1, intdiv($retryAfterSeconds + 59, 60));

        parent::__construct(sprintf(
            'Too many incorrect PIN attempts. Try again in %d %s.',
            $minutes,
            $minutes === 1 ? 'minute' : 'minutes',
        ));
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], 429, [
            'Retry-After' => (string) max(1, $this->retryAfterSeconds),
        ]);
    }

    /**
     * A lock is an expected outcome, not an error worth logging.
     */
    public function report(): bool
    {
        return true;
    }
}
