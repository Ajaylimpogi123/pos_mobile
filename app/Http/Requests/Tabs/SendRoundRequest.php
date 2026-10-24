<?php

namespace App\Http\Requests\Tabs;

use App\Http\Requests\Sales\StoreOrderRequest;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/tabs/{ulid}/rounds (`sale.create`; idempotent: `Idempotency-Key` = the body's
 * `ulid`). `items` (1–100), each `product_id`, `qty` (1–999) and `notes` (max 120): the
 * `POST /orders` item rules, with no discounts. The menu, stock and 200-line checks follow in
 * App\Actions\Tabs\SendRoundAction. See TabRequest.
 */
class SendRoundRequest extends TabRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'items' => ['required', 'array', 'list', 'min:1', 'max:'.StoreOrderRequest::MAX_ITEMS],
            'items.*' => ['array'],
            'items.*.product_id' => ['required', 'integer'],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:'.StoreOrderRequest::MAX_QTY],
            'items.*.notes' => ['sometimes', 'nullable', 'string', 'max:120'],
        ];
    }
}
