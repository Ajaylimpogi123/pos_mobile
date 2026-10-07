<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

/**
 * An `Idempotency-Key` and, once its first request succeeded, that request's stored
 * response (Global Conventions, *Idempotent requests*). See
 * App\Http\Middleware\EnsureIdempotentRequest.
 *
 * @property int $id
 * @property string $key
 * @property int $branch_id
 * @property int $user_id
 * @property string $endpoint e.g. `POST api/v1/orders`
 * @property string $request_hash
 * @property string $status
 * @property int|null $response_status
 * @property string|null $response_body
 * @property CarbonInterface $created_at
 * @property CarbonInterface $updated_at
 */
class IdempotencyKey extends Model
{
    public const STATUS_PROCESSING = 'processing';

    public const STATUS_COMPLETED = 'completed';

    /**
     * A claim still `processing` after this long belongs to a request that died (a crash
     * or timeout never released it), so a retry may take it over instead of getting 409
     * forever. Far above any real request time.
     */
    public const STALE_AFTER_SECONDS = 60;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'user_id' => 'integer',
            'response_status' => 'integer',
        ];
    }

    public function isCompleted(): bool
    {
        return $this->status === self::STATUS_COMPLETED;
    }

    public function isStale(): bool
    {
        return $this->status === self::STATUS_PROCESSING
            && $this->updated_at->lte(now()->subSeconds(self::STALE_AFTER_SECONDS));
    }

    /**
     * Store the first successful response, making the key replayable.
     */
    public function complete(SymfonyResponse $response): void
    {
        $this->forceFill([
            'status' => self::STATUS_COMPLETED,
            'response_status' => $response->getStatusCode(),
            'response_body' => (string) $response->getContent(),
        ])->save();
    }

    /**
     * The stored status and body, marked as a replay.
     */
    public function replay(): Response
    {
        return new Response((string) $this->response_body, (int) $this->response_status, [
            'Content-Type' => 'application/json',
            'Idempotency-Replayed' => 'true',
        ]);
    }
}
