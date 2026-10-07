<?php

namespace App\Http\Requests\Sync;

use App\Http\Requests\Sales\DiscountRules;
use App\Http\Requests\Sales\ScPwdRules;
use App\Http\Requests\Sales\StoreOrderRequest;
use App\Models\Payment;
use App\Support\Ulid;
use Closure;
use Illuminate\Validation\Rule;

/**
 * Field rules of one `OfflineOrder` in POST /api/v1/sync/orders (Phase 5): the
 * POST /orders body without `discount_authorization`, plus `order_no`, `placed_at`,
 * `cashier_id` and each line's snapshot `unit_price_cents`. Phase 6 adds `shift_ulid`, and
 * the SC/PWD feature `sc_pwd` and `items.*.sc_pwd` (ScPwdRules, as for POST /orders).
 *
 * Each order is validated on its own (App\Actions\Sync\IngestOfflineOrderAction): a
 * failure rejects that order only, with the first message. `customer_id` is only checked
 * to be an integer here; the ingest rejects an id that never existed.
 */
final class OfflineOrderRules
{
    /**
     * `{device code}-{business date YYYYMMDD}-{daily sequence}`, e.g. `T01-20260926-0005`.
     */
    public const ORDER_NO_PATTERN = '/^[A-Z0-9]{1,8}-\d{8}-\d{4,6}$/D';

    /**
     * An ISO 8601 date-time with a `Z` or `±HH:MM` offset and optional fractional seconds
     * (JavaScript's `toISOString()` sends milliseconds).
     */
    public const PLACED_AT_PATTERN = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/D';

    public const MAX_UNIT_PRICE_CENTS = 100000000;

    /**
     * The order as validated: `table_no` trimmed, and an empty one stored as null (as for
     * POST /orders).
     *
     * @return array<string, mixed>
     */
    public static function prepare(mixed $order): array
    {
        if (! is_array($order)) {
            return [];
        }

        if (is_string($order['table_no'] ?? null)) {
            $tableNo = trim($order['table_no']);
            $order['table_no'] = $tableNo === '' ? null : $tableNo;
        }

        return $order;
    }

    /**
     * @param  array<string, mixed>  $order  The prepared order (for the one-cash rule)
     * @return array<string, list<mixed>>
     */
    public static function rules(array $order): array
    {
        // SC/PWD (ScPwdRules): `sc_pwd`, `items.*.sc_pwd`, and the no-double-discount rules.
        return ScPwdRules::withRulesOf(self::orderRules($order), $order);
    }

    /**
     * The order's own field rules (without SC/PWD).
     *
     * @param  array<string, mixed>  $order
     * @return array<string, list<mixed>>
     */
    private static function orderRules(array $order): array
    {
        return [
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'order_no' => ['required', 'string', 'regex:'.self::ORDER_NO_PATTERN],
            'placed_at' => ['required', 'string', 'regex:'.self::PLACED_AT_PATTERN, 'date'],
            'cashier_id' => ['required', 'integer'],
            // Phase 6: never rejected for its shift (the ingest flags `shift_closed`).
            'shift_ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'customer_id' => ['sometimes', 'nullable', 'integer'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:255'],
            'table_no' => ['sometimes', 'nullable', 'string', 'max:'.StoreOrderRequest::MAX_TABLE_NO, 'regex:/^[A-Za-z0-9 -]+$/D'],

            'items' => ['required', 'array', 'list', 'min:1', 'max:'.StoreOrderRequest::MAX_ITEMS],
            'items.*' => ['array'],
            'items.*.product_id' => ['required', 'integer'],
            'items.*.qty' => ['required', 'integer', 'min:1', 'max:'.StoreOrderRequest::MAX_QTY],
            'items.*.unit_price_cents' => ['required', 'integer:strict', 'min:0', 'max:'.self::MAX_UNIT_PRICE_CENTS],
            ...DiscountRules::for('items.*.discount'),
            'items.*.notes' => ['sometimes', 'nullable', 'string', 'max:120'],

            ...DiscountRules::for('discount'),

            'payments' => ['present', 'array', 'list', 'max:'.StoreOrderRequest::MAX_PAYMENTS],
            'payments.*' => ['array'],
            'payments.*.method' => ['bail', 'required', 'string', Rule::in(Payment::METHODS), self::atMostOneCash($order)],
            'payments.*.amount_cents' => ['required', 'integer:strict', 'min:1', 'max:'.StoreOrderRequest::MAX_PAYMENT_CENTS],
            'payments.*.reference_no' => [
                'required_if:payments.*.method,'.Payment::METHOD_GCASH,
                'prohibited_if:payments.*.method,'.Payment::METHOD_CASH,
                'nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9-]+$/D',
            ],

            'client_total_cents' => ['required', 'integer:strict', 'min:0'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            'payments.present' => trans('validation.required'),
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function attributes(): array
    {
        return [
            ...DiscountRules::attributes('discount'),
            ...DiscountRules::attributes('items.*.discount'),
            ...ScPwdRules::attributes(),
        ];
    }

    /**
     * `payments.*.method`: at most one `cash` payment; later ones are rejected.
     *
     * @param  array<string, mixed>  $order
     */
    private static function atMostOneCash(array $order): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($order): void {
            if ($value !== Payment::METHOD_CASH) {
                return;
            }

            $index = (int) explode('.', $attribute)[1];
            $payments = is_array($order['payments'] ?? null) ? $order['payments'] : [];

            foreach (array_slice($payments, 0, $index) as $earlier) {
                if (is_array($earlier) && ($earlier['method'] ?? null) === Payment::METHOD_CASH) {
                    $fail(StoreOrderRequest::MESSAGE_ONE_CASH);

                    return;
                }
            }
        };
    }
}
