<?php

namespace App\Http\Requests\Sales;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/orders/{ulid}/void (Phase 7; `sale.create` or `sale.void`; idempotent with an
 * `Idempotency-Key` the app makes when the void dialog opens). See OrderReversalRequest for
 * the order of the checks; the state, window and approval checks follow in
 * App\Actions\Sales\VoidOrderAction.
 *
 * Body: `reason` (required, max 255) and `authorization` (nullable `{ user_id, pin }`).
 */
class VoidOrderRequest extends OrderReversalRequest
{
    public const MAX_REASON = 255;

    public function authorize(): bool
    {
        return $this->authorizeReversal('void');
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'reason' => ['required', 'string', 'max:'.self::MAX_REASON],
            ...self::authorizationRules(),
        ];
    }
}
