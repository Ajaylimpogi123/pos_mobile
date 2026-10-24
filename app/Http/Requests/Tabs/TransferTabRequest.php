<?php

namespace App\Http\Requests\Tabs;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/tabs/{ulid}/transfer (T2; `sale.create`; idempotent). Body `table_id`: an
 * active table of the caller's branch (whether it is free is checked by
 * App\Actions\Tabs\TransferTabAction, `409`). See TabRequest.
 */
class TransferTabRequest extends TabRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'table_id' => ['bail', 'required', 'integer', TabRules::activeTable((int) $this->actor()->branch_id)],
        ];
    }
}
