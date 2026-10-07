<?php

namespace App\Http\Requests\Sales;

use App\Support\Sales\ScPwd;
use Closure;
use Illuminate\Validation\Rule;

/**
 * Field rules of the Senior Citizen / PWD request (SC/PWD contract, *Request: `sc_pwd`*),
 * shared by POST /api/v1/orders (StoreOrderRequest) and each `OfflineOrder` of
 * POST /api/v1/sync/orders (App\Http\Requests\Sync\OfflineOrderRules):
 *
 * - `sc_pwd`: `null` or omitted means no SC/PWD; otherwise `mode` (`items` | `headcount`),
 *   `persons` (1–10, each with a `type` and a distinct `id_no`), `diners` (`headcount`:
 *   required, persons count–100; `items`: null) and `vat_exempt` (boolean).
 * - `items.*.sc_pwd`: boolean. `items` mode: at least one line is marked. `headcount`: none
 *   is. Without `sc_pwd`, a marked line is invalid.
 * - No double discount: a line discount on a marked line, any line discount in `headcount`
 *   mode, and an order discount with `sc_pwd` are 422s on that discount.
 *
 * `senior_citizen` and `pwd` stay invalid as a discount `type` (DiscountRules).
 */
final class ScPwdRules
{
    public const MESSAGE_DOUBLE_DISCOUNT = "SC/PWD can't be combined with another discount.";

    public const MESSAGE_NO_ITEMS_MARKED = 'Tick the items for the senior citizen or PWD.';

    public const ID_NO_PATTERN = '/^[A-Za-z0-9\/ -]+$/D';

    public const MAX_ID_NO = 30;

    /**
     * The SC/PWD rules, plus the extra rules of `items`, `items.*.discount` and `discount`
     * (merge them with StoreOrderRequest's / OfflineOrderRules' via withRulesOf()).
     *
     * @param  array<string, mixed>  $input  The order as sent
     * @return array<string, list<mixed>>
     */
    public static function for(array $input): array
    {
        $scPwd = self::scPwdOf($input);
        $personsCount = is_array($scPwd['persons'] ?? null) ? count($scPwd['persons']) : 0;

        return [
            // An empty object is not "no SC/PWD": it must carry its fields.
            'sc_pwd' => ['sometimes', 'nullable', 'array', self::notEmptyObject(...)],
            'sc_pwd.mode' => ['required_with:sc_pwd', 'string', Rule::in(ScPwd::MODES)],
            'sc_pwd.persons' => ['required_with:sc_pwd', 'array', 'list', 'min:1', 'max:'.ScPwd::MAX_PERSONS],
            'sc_pwd.persons.*' => ['array'],
            'sc_pwd.persons.*.type' => ['required', 'string', Rule::in(ScPwd::TYPES)],
            'sc_pwd.persons.*.id_no' => ['required', 'string', 'max:'.self::MAX_ID_NO, 'regex:'.self::ID_NO_PATTERN, 'distinct'],
            'sc_pwd.diners' => [
                'nullable',
                'required_if:sc_pwd.mode,'.ScPwd::MODE_HEADCOUNT,
                'prohibited_if:sc_pwd.mode,'.ScPwd::MODE_ITEMS,
                'integer',
                'min:'.max(1, $personsCount),
                'max:'.ScPwd::MAX_DINERS,
            ],
            'sc_pwd.vat_exempt' => ['required_with:sc_pwd', 'boolean'],
            'items.*.sc_pwd' => ['sometimes', 'boolean', self::lineMarkAllowed($scPwd)],
        ];
    }

    /**
     * `$rules` with the SC/PWD rules added, including the no-double-discount rules on
     * `items.*.discount` and `discount` and the "no line marked" rule on `items`.
     *
     * @param  array<string, mixed>  $rules
     * @param  array<string, mixed>  $input  The order as sent
     * @return array<string, mixed>
     */
    public static function withRulesOf(array $rules, array $input): array
    {
        $scPwd = self::scPwdOf($input);

        $rules['items'][] = self::someLineMarked($scPwd);
        $rules['items.*.discount'][] = self::lineDiscountAllowed($scPwd, $input);
        $rules['discount'][] = self::orderDiscountAllowed($scPwd);

        return [...$rules, ...self::for($input)];
    }

    /**
     * Display names, so messages read `The selected sc pwd is invalid.` (a marked line) and
     * name the SC/PWD fields plainly.
     *
     * @return array<string, string>
     */
    public static function attributes(): array
    {
        return [
            'items.*.sc_pwd' => 'sc pwd',
            'sc_pwd.mode' => 'mode',
            'sc_pwd.persons' => 'persons',
            'sc_pwd.persons.*.type' => 'type',
            'sc_pwd.persons.*.id_no' => 'ID number',
            'sc_pwd.diners' => 'diners',
            'sc_pwd.vat_exempt' => 'VAT exempt',
        ];
    }

    /**
     * The `sc_pwd` object when one is sent (a non-empty array), else null.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>|null
     */
    private static function scPwdOf(array $input): ?array
    {
        $scPwd = $input['sc_pwd'] ?? null;

        return is_array($scPwd) && $scPwd !== [] ? $scPwd : null;
    }

    /**
     * `sc_pwd`: `{}` is neither "no SC/PWD" (that is `null` or omitted) nor a valid entry.
     * A closure, not `filled`, because `filled` is implicit and would reject `null` too.
     */
    private static function notEmptyObject(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value === []) {
            $fail('validation.filled')->translate();
        }
    }

    /**
     * `items.*.sc_pwd`: a marked line needs `sc_pwd`, in `items` mode.
     *
     * @param  array<string, mixed>|null  $scPwd
     */
    private static function lineMarkAllowed(?array $scPwd): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($scPwd): void {
            if (! self::isMarked($value)) {
                return;
            }

            if ($scPwd === null || ($scPwd['mode'] ?? null) === ScPwd::MODE_HEADCOUNT) {
                $fail('validation.in')->translate();
            }
        };
    }

    /**
     * `items`: in `items` mode, at least one line is marked.
     *
     * @param  array<string, mixed>|null  $scPwd
     */
    private static function someLineMarked(?array $scPwd): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($scPwd): void {
            if ($scPwd === null || ($scPwd['mode'] ?? null) !== ScPwd::MODE_ITEMS || ! is_array($value)) {
                return;
            }

            foreach ($value as $item) {
                if (is_array($item) && self::isMarked($item['sc_pwd'] ?? false)) {
                    return;
                }
            }

            $fail(self::MESSAGE_NO_ITEMS_MARKED);
        };
    }

    /**
     * `items.*.discount`: none on a marked line, and none at all in `headcount` mode.
     *
     * @param  array<string, mixed>|null  $scPwd
     * @param  array<string, mixed>  $input
     */
    private static function lineDiscountAllowed(?array $scPwd, array $input): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($scPwd, $input): void {
            if ($scPwd === null || $value === null) {
                return;
            }

            $index = (int) explode('.', $attribute)[1];
            $item = $input['items'][$index] ?? null;
            $marked = is_array($item) && self::isMarked($item['sc_pwd'] ?? false);

            if ($marked || ($scPwd['mode'] ?? null) === ScPwd::MODE_HEADCOUNT) {
                $fail(self::MESSAGE_DOUBLE_DISCOUNT);
            }
        };
    }

    /**
     * `discount`: no order discount with `sc_pwd`.
     *
     * @param  array<string, mixed>|null  $scPwd
     */
    private static function orderDiscountAllowed(?array $scPwd): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($scPwd): void {
            if ($scPwd !== null && $value !== null) {
                $fail(self::MESSAGE_DOUBLE_DISCOUNT);
            }
        };
    }

    /**
     * A truthy `boolean` value as the validator accepts it (`true`, `1`, `"1"`).
     */
    private static function isMarked(mixed $value): bool
    {
        return in_array($value, [true, 1, '1'], true);
    }
}
