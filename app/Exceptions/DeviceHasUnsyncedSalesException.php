<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * Retiring a tablet whose last heartbeat reported unsynced sales, without `confirm`
 * (Hardening & Pilot → C): `409 { "message": "...", "outbox_pending": 5 }`.
 */
class DeviceHasUnsyncedSalesException extends RuntimeException
{
    public function __construct(string $message, public readonly int $outboxPending)
    {
        parent::__construct($message);
    }

    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'outbox_pending' => $this->outboxPending], 409);
    }

    /**
     * An expected outcome, not an error worth logging.
     */
    public function report(): bool
    {
        return true;
    }
}
