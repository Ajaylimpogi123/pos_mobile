<?php

namespace App\Http\Requests\Reservations;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * PATCH /api/v1/reservations/{ulid} (Table Management → E.3; idempotent). Partial: the create
 * fields (ReservationRules), only the ones sent. See ReservationRequest.
 */
class UpdateReservationRequest extends ReservationRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            ...ReservationRules::rules(store: false, branchId: (int) $this->actor()->branch_id),
        ];
    }
}
