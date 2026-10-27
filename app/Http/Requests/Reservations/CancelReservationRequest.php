<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/reservations/{ulid}/cancel (Table Management → E.4; idempotent). Body `reason`
 * (nullable, max 255). See ReservationRequest.
 */
class CancelReservationRequest extends ReservationRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'reason' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
