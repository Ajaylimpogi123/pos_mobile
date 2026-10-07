<?php

namespace App\Actions\Idempotency;

use App\Exceptions\ConflictException;
use App\Models\IdempotencyKey;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Claims an `Idempotency-Key` for a request (Global Conventions, *Idempotent requests*).
 *
 * - An unknown key is claimed: a `processing` row is inserted (outside any transaction,
 *   so concurrent requests see it at once). The UNIQUE key makes the claim atomic.
 * - A key stored for a different endpoint or body → 409.
 * - A `completed` key for the same endpoint and body → replay its stored response.
 * - A `processing` key → 409, unless it is stale (its request died without releasing
 *   it), in which case the new request takes it over.
 *
 * Keys are unique across users, because the key must equal the body's `ulid`: whoever
 * in the same branch sends the same key, endpoint and body gets the stored response
 * (e.g. the next cashier after a PIN switch retrying the pending sale). A key stored by
 * another branch counts as a different request, so no response crosses branches.
 */
class ClaimIdempotencyKey
{
    public const MESSAGE_DIFFERENT_REQUEST = 'This Idempotency-Key was already used for a different request.';

    public const MESSAGE_IN_PROGRESS = 'This request is still being processed. Try again in a moment.';

    private const MAX_ROUNDS = 3;

    /**
     * @param  string  $endpoint  e.g. `POST api/v1/orders`
     * @param  string  $requestHash  App\Support\RequestFingerprint of the body
     *
     * @throws ConflictException 409 for a different request, or one still in flight
     */
    public function execute(string $key, User $user, string $endpoint, string $requestHash): IdempotencyClaim
    {
        for ($round = 0; $round < self::MAX_ROUNDS; $round++) {
            $existing = IdempotencyKey::query()->where('key', $key)->first();

            if ($existing === null) {
                try {
                    $record = new IdempotencyKey;
                    $record->forceFill([
                        'key' => $key,
                        'branch_id' => $user->branch_id,
                        'user_id' => $user->id,
                        'endpoint' => $endpoint,
                        'request_hash' => $requestHash,
                        'status' => IdempotencyKey::STATUS_PROCESSING,
                    ])->save();

                    return new IdempotencyClaim($record, replay: false);
                } catch (UniqueConstraintViolationException) {
                    // Claimed by a concurrent request a moment ago: look again.
                    continue;
                }
            }

            if ($existing->branch_id !== $user->branch_id
                || $existing->endpoint !== $endpoint
                || ! hash_equals($existing->request_hash, $requestHash)) {
                throw new ConflictException(self::MESSAGE_DIFFERENT_REQUEST);
            }

            if ($existing->isCompleted()) {
                return new IdempotencyClaim($existing, replay: true);
            }

            if (! $existing->isStale()) {
                throw new ConflictException(self::MESSAGE_IN_PROGRESS);
            }

            // Take over a claim whose request died, unless someone else just did.
            $takenOver = IdempotencyKey::query()
                ->whereKey($existing->id)
                ->where('status', IdempotencyKey::STATUS_PROCESSING)
                ->where('updated_at', $existing->getRawOriginal('updated_at'))
                ->update(['user_id' => $user->id, 'updated_at' => now()]);

            if ($takenOver === 1) {
                return new IdempotencyClaim($existing->refresh(), replay: false);
            }
        }

        throw new ConflictException(self::MESSAGE_IN_PROGRESS);
    }
}
