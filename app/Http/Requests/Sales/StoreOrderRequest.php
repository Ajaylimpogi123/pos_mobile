<?php

namespace App\Http\Requests\Sales;

use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Shift;
use App\Models\User;
use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/orders (permission `sale.create`; idempotent).
 *
 * Step 1 of the contract's checks: 403 without `sale.create` (checked before validation),
 * then the field rules. The business checks (menu, pricing, checksum, payments, discount
 * approval, stock) follow in App\Actions\Sales\CompleteSaleAction.
 *
 * Money fields must be JSON integers (`integer:strict`), as in the catalogue. `payments`
 * may be empty (a ₱0 sale); an empty or short payment is reported by the payment check.
 *
 * Phase 6: `shift_ulid` is required; a shift of the caller's branch that is already closed
 * is a 422 on `shift_ulid` (`This shift is closed. Open a new shift.`).
 *
 * SC/PWD: `sc_pwd` and `items.*.sc_pwd`, with the no-double-discount 422s (ScPwdRules).
 */
class StoreOrderRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    public const MAX_ITEMS = 100;

    public const MAX_QTY = 999;

    public const MAX_PAYMENTS = 5;

    public const MAX_PAYMENT_CENTS = 1000000000;

    public const MAX_TABLE_NO = 10;

    public const MESSAGE_ONE_CASH = 'Only one cash payment is allowed.';

    public const MESSAGE_SHIFT_CLOSED = 'This shift is closed. Open a new shift.';

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', Order::class) ?? false;
    }

    /**
     * `table_no`: surrounding spaces are trimmed and an empty string becomes null (done
     * here too, so it holds even without the global TrimStrings middleware).
     */
    protected function prepareForValidation(): void
    {
        $tableNo = $this->input('table_no');

        if (is_string($tableNo)) {
            $tableNo = trim($tableNo);
            $this->merge(['table_no' => $tableNo === '' ? null : $tableNo]);
        }
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        // SC/PWD (ScPwdRules): `sc_pwd`, `items.*.sc_pwd`, and the no-double-discount rules.
        return ScPwdRules::withRulesOf($this->orderRules(), $this->all());
    }

    /**
     * The order's own field rules (without SC/PWD).
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    private function orderRules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            // Phase 6: the tablet's open shift. A shift the server doesn't know yet is accepted
            // (its open event may still be in the outbox); a known, closed one is not.
            'shift_ulid' => ['bail', 'required', 'string', 'regex:'.Ulid::PATTERN, $this->shiftNotClosed(...)],
            'customer_id' => ['sometimes', 'nullable', 'integer', Rule::exists('customers', 'id')->whereNull('deleted_at')],
            'notes' => ['sometimes', 'nullable', 'string', 'max:255'],
            // Core Sale revision 2: a free label, e.g. `12`, `A3`, `Patio 2`.
            'table_no' => ['sometimes', 'nullable', 'string', 'max:'.self::MAX_TABLE_NO, 'regex:/^[A-Za-z0-9 -]+$/D'],

            'items' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_ITEMS],
            'items.*' => ['array'],
            'items.*.product_id' => ['required', 'integer'],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:'.self::MAX_QTY],
            ...DiscountRules::for('items.*.discount'),
            'items.*.notes' => ['sometimes', 'nullable', 'string', 'max:120'],

            ...DiscountRules::for('discount'),

            'payments' => ['present', 'array', 'list', 'max:'.self::MAX_PAYMENTS],
            'payments.*' => ['array'],
            'payments.*.method' => ['bail', 'required', 'string', Rule::in(Payment::METHODS), $this->atMostOneCash(...)],
            'payments.*.amount_cents' => ['required', 'integer:strict', 'min:1', 'max:'.self::MAX_PAYMENT_CENTS],
            'payments.*.reference_no' => [
                'required_if:payments.*.method,'.Payment::METHOD_GCASH,
                'prohibited_if:payments.*.method,'.Payment::METHOD_CASH,
                'nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/D',
            ],

            'client_total_cents' => ['required', 'integer:strict', 'min:0'],

            'discount_authorization' => ['sometimes', 'nullable', 'array', 'required_array_keys:user_id,pin'],
            'discount_authorization.user_id' => ['sometimes', 'required', 'integer'],
            'discount_authorization.pin' => ['sometimes', 'required', 'string', 'regex:/^\d{4,6}$/D'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            // `present` (not `required`) lets an empty list through for a ₱0 sale.
            'payments.present' => trans('validation.required'),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function attributes(): array
    {
        return [
            ...DiscountRules::attributes('discount'),
            ...DiscountRules::attributes('items.*.discount'),
            ...ScPwdRules::attributes(),
        ];
    }

    /**
     * `shift_ulid`: when the caller's branch knows the shift, it must still be open.
     */
    private function shiftNotClosed(string $attribute, mixed $value, Closure $fail): void
    {
        $user = $this->user();

        $closed = $user instanceof User && Shift::query()
            ->where('branch_id', $user->branch_id)
            ->where('ulid', $value)
            ->whereNotNull('closed_at')
            ->exists();

        if ($closed) {
            $fail(self::MESSAGE_SHIFT_CLOSED);
        }
    }

    /**
     * `payments.*.method`: at most one `cash` payment; later ones are rejected.
     */
    private function atMostOneCash(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value !== Payment::METHOD_CASH) {
            return;
        }

        $index = (int) explode('.', $attribute)[1];
        $payments = Arr::wrap($this->input('payments'));

        foreach (array_slice($payments, 0, $index) as $earlier) {
            if (is_array($earlier) && ($earlier['method'] ?? null) === Payment::METHOD_CASH) {
                $fail(self::MESSAGE_ONE_CASH);

                return;
            }
        }
    }
}
