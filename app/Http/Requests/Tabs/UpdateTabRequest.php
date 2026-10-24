<?php

namespace App\Http\Requests\Tabs;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * PATCH /api/v1/tabs/{ulid} (`sale.create`; idempotent). Partial: `guests` (1–99),
 * `customer_id` (nullable) and `notes` (nullable, max 255). See TabRequest.
 */
class UpdateTabRequest extends TabRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'guests' => ['sometimes', 'required', 'integer', 'min:1', 'max:'.TabRules::MAX_GUESTS],
            'customer_id' => ['sometimes', 'nullable', 'integer', TabRules::customer()],
            'notes' => ['sometimes', 'nullable', 'string', 'max:'.TabRules::MAX_NOTES],
        ];
    }
}
