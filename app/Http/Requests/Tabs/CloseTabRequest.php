<?php

namespace App\Http\Requests\Tabs;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/tabs/{ulid}/close (`sale.create`; idempotent). No body. See TabRequest.
 */
class CloseTabRequest extends TabRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->idempotencyKeyRules();
    }
}
