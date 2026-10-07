<?php

namespace App\Actions\Idempotency;

use App\Models\IdempotencyKey;

/**
 * The outcome of claiming an `Idempotency-Key`: either the request now owns the key
 * (`replay: false`) and must complete or release it, or the key already holds a stored
 * response to send back (`replay: true`).
 */
final readonly class IdempotencyClaim
{
    public function __construct(
        public IdempotencyKey $record,
        public bool $replay,
    ) {}
}
