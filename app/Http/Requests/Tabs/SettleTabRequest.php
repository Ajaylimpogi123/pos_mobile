<?php

namespace App\Http\Requests\Tabs;

use App\Http\Requests\Sales\DiscountRules;
use App\Http\Requests\Sales\ScPwdRules;
use App\Http\Requests\Sales\StoreOrderRequest;
use App\Models\Payment;
use App\Models\Shift;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\User;
use App\Support\Sales\ScPwd;
use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Arr;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/tabs/{ulid}/settle (`sale.create`; idempotent: `Idempotency-Key` = the body's
 * `ulid`). After TabRequest's checks, the field rules of the `POST /orders` body
 * (StoreOrderRequest, ScPwdRules, DiscountRules), with these differences (§D.6):
 *
 * - `items.*` is `{ tab_item_id, qty, discount, sc_pwd }`; a `tab_item_id` not on this tab is
 *   a `422` on `items.{i}.tab_item_id`. `items` may be omitted (settle everything remaining).
 * - In `headcount` mode, `sc_pwd.diners` defaults to the tab's `guests`.
 * - `service_charge` (boolean, default true) and `split_count` (nullable, 2–10).
 * - `payments`: max 10; at most one `cash` unless `split_count` is set.
 * - The open-shift rule of `POST /orders`: a known, closed shift is a `422` on `shift_ulid`.
 *
 * The pricing, checksum, payment, approval and quantity checks follow in
 * App\Actions\Tabs\SettleTabAction.
 */
class SettleTabRequest extends TabRequest
{
    public const MAX_PAYMENTS = 10;

    public const MIN_SPLIT = 2;

    public const MAX_SPLIT = 10;

    public const MESSAGE_NOT_ON_TAB = "This item isn't on this bill.";

    /**
     * `sc_pwd.diners` defaults to the tab's guests in `headcount` mode. Runs before
     * authorize(), so the tab is looked up quietly here (any failure is answered later).
     */
    protected function prepareForValidation(): void
    {
        $scPwd = $this->input('sc_pwd');

        if (! is_array($scPwd) || ($scPwd['mode'] ?? null) !== ScPwd::MODE_HEADCOUNT || ($scPwd['diners'] ?? null) !== null) {
            return;
        }

        $user = $this->user();
        $guests = $user instanceof User
            ? Tab::query()
                ->where('branch_id', $user->branch_id)
                ->where('ulid', strtoupper((string) $this->route('ulid')))
                ->value('guests')
            : null;

        if ($guests !== null) {
            $this->merge(['sc_pwd' => [...$scPwd, 'diners' => (int) $guests]]);
        }
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return ScPwdRules::withRulesOf($this->settleRules(), $this->all());
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    private function settleRules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'shift_ulid' => ['bail', 'required', 'string', 'regex:'.Ulid::PATTERN, $this->shiftNotClosed(...)],
            'customer_id' => ['sometimes', 'nullable', 'integer', TabRules::customer()],
            'notes' => ['sometimes', 'nullable', 'string', 'max:255'],

            'items' => ['sometimes', 'array', 'list', 'min:1', 'max:'.StoreOrderRequest::MAX_ITEMS],
            'items.*' => ['array'],
            'items.*.tab_item_id' => ['bail', 'required', 'integer', $this->onThisTab(...)],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:'.StoreOrderRequest::MAX_QTY],
            ...DiscountRules::for('items.*.discount'),

            ...DiscountRules::for('discount'),

            'service_charge' => ['sometimes', 'boolean'],
            'split_count' => ['sometimes', 'nullable', 'integer', 'min:'.self::MIN_SPLIT, 'max:'.self::MAX_SPLIT],

            'payments' => ['present', 'array', 'list', 'max:'.self::MAX_PAYMENTS],
            'payments.*' => ['array'],
            'payments.*.method' => ['bail', 'required', 'string', Rule::in(Payment::METHODS), $this->atMostOneCash(...)],
            'payments.*.amount_cents' => ['required', 'integer:strict', 'min:1', 'max:'.StoreOrderRequest::MAX_PAYMENT_CENTS],
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
     * `shift_ulid`: when the caller's branch knows the shift, it must still be open (as for
     * `POST /orders`).
     */
    private function shiftNotClosed(string $attribute, mixed $value, Closure $fail): void
    {
        $closed = Shift::query()
            ->where('branch_id', $this->actor()->branch_id)
            ->where('ulid', $value)
            ->whereNotNull('closed_at')
            ->exists();

        if ($closed) {
            $fail(StoreOrderRequest::MESSAGE_SHIFT_CLOSED);
        }
    }

    /**
     * `items.*.tab_item_id`: a line of this tab.
     */
    private function onThisTab(string $attribute, mixed $value, Closure $fail): void
    {
        if (! TabItem::query()->where('tab_id', $this->tab()->id)->whereKey((int) $value)->exists()) {
            $fail(self::MESSAGE_NOT_ON_TAB);
        }
    }

    /**
     * `payments.*.method`: at most one `cash` payment, unless the bill is split equally.
     */
    private function atMostOneCash(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value !== Payment::METHOD_CASH || $this->input('split_count') !== null) {
            return;
        }

        $index = (int) explode('.', $attribute)[1];
        $payments = Arr::wrap($this->input('payments'));

        foreach (array_slice($payments, 0, $index) as $earlier) {
            if (is_array($earlier) && ($earlier['method'] ?? null) === Payment::METHOD_CASH) {
                $fail(StoreOrderRequest::MESSAGE_ONE_CASH);

                return;
            }
        }
    }
}
