<?php

namespace App\Http\Requests\Sales;

use App\Models\Payment;
use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/orders/{ulid}/refunds (Phase 7; `sale.create` or `sale.refund`; idempotent:
 * `Idempotency-Key` = the body's `ulid`). See OrderReversalRequest for the order of the
 * checks; the state, quantity, checksum, payment, shift and approval checks follow in
 * App\Actions\Sales\RefundOrderAction.
 *
 * - `items`: 1–100 lines, each a distinct line of **this** order (`This line isn't part of
 *   the sale.`) with a whole `qty` ≥ 1.
 * - `payments`: at most 2, at most one per method (as for sales: `Only one cash payment is
 *   allowed.`); may be empty (a ₱0 refund), which the payment check reports otherwise.
 *   GCash needs its `reference_no`; cash must not send one.
 * - Money fields must be JSON integers (`integer:strict`), as for sales.
 */
class StoreRefundRequest extends OrderReversalRequest
{
    public const MAX_ITEMS = 100;

    public const MAX_PAYMENTS = 2;

    public const MAX_REASON = 255;

    public const MESSAGE_NOT_A_LINE = "This line isn't part of the sale.";

    public const MESSAGE_ONE_PER_METHOD = 'Only one %s payment is allowed.';

    public function authorize(): bool
    {
        return $this->authorizeReversal('refund');
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'shift_ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'reason' => ['required', 'string', 'max:'.self::MAX_REASON],

            'items' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_ITEMS],
            'items.*' => ['array'],
            'items.*.order_item_id' => [
                'bail', 'required', 'integer', 'distinct',
                Rule::exists('order_items', 'id')->where('order_id', $this->order()->id),
            ],
            'items.*.qty' => ['required', 'integer', 'min:1'],

            'payments' => ['present', 'array', 'list', 'max:'.self::MAX_PAYMENTS],
            'payments.*' => ['array'],
            'payments.*.method' => ['bail', 'required', 'string', Rule::in(Payment::METHODS), $this->atMostOnePerMethod(...)],
            'payments.*.amount_cents' => ['required', 'integer:strict', 'min:1'],
            'payments.*.reference_no' => [
                'required_if:payments.*.method,'.Payment::METHOD_GCASH,
                'prohibited_if:payments.*.method,'.Payment::METHOD_CASH,
                'nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/D',
            ],

            'client_refund_cents' => ['required', 'integer:strict', 'min:0'],

            ...self::authorizationRules(),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'items.*.order_item_id.exists' => self::MESSAGE_NOT_A_LINE,
            // `present` (not `required`) lets an empty list through for a ₱0 refund.
            'payments.present' => trans('validation.required'),
        ];
    }

    /**
     * `payments.*.method`: at most one payment per method; later ones are rejected.
     */
    private function atMostOnePerMethod(string $attribute, mixed $value, Closure $fail): void
    {
        $index = (int) explode('.', $attribute)[1];
        $payments = Arr::wrap($this->input('payments'));

        foreach (array_slice($payments, 0, $index) as $earlier) {
            if (is_array($earlier) && ($earlier['method'] ?? null) === $value) {
                $fail(sprintf(self::MESSAGE_ONE_PER_METHOD, $value === Payment::METHOD_GCASH ? 'GCash' : 'cash'));

                return;
            }
        }
    }
}
