<?php

namespace App\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * The request is valid but conflicts with current data.
 * Renders the contract's `409 { "message": "..." }` body (no debug details).
 */
class ConflictException extends RuntimeException
{
    public function render(): JsonResponse
    {
        return response()->json(['message' => $this->getMessage()], 409);
    }

    /**
     * Conflicts are expected outcomes, not errors worth logging.
     */
    public function report(): bool
    {
        return true;
    }
}
