<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/reservations/{ulid}/no-show (Table Management → E.5; idempotent; no body).
 * See ReservationRequest.
 */
class NoShowReservationRequest extends ReservationRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->idempotencyKeyRules();
    }
}
