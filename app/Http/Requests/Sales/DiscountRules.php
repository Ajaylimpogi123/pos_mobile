<?php

namespace App\Http\Requests\Sales;

use App\Rules\DiscountValue;
use App\Support\Sales\Discount;
use Illuminate\Validation\Rule;

/**
 * Field rules for a discount object `{ type, kind, value }` (Phase 3 contract,
 * *Discount rules*), used for the order discount and for each line discount. The
 * object is optional and nullable; when sent, all three keys are required.
 * `senior_citizen` and `pwd` are rejected (`The selected type is invalid.`): SC/PWD only
 * goes through `sc_pwd` (ScPwdRules).
 */
final class DiscountRules
{
    /**
     * @param  string  $prefix  The discount field, e.g. `discount` or `items.*.discount`
     * @return array<string, list<mixed>>
     */
    public static function for(string $prefix): array
    {
        return [
            $prefix => ['sometimes', 'nullable', 'array', 'required_array_keys:type,kind,value'],
            "{$prefix}.type" => ['sometimes', 'required', 'string', Rule::in(Discount::TYPES)],
            "{$prefix}.kind" => ['sometimes', 'required', 'string', Rule::in(Discount::KINDS)],
            "{$prefix}.value" => ['sometimes', 'bail', 'required', 'integer:strict', new DiscountValue],
        ];
    }

    /**
     * Display names, so messages read `The selected type is invalid.`
     *
     * @return array<string, string>
     */
    public static function attributes(string $prefix): array
    {
        return [
            "{$prefix}.type" => 'type',
            "{$prefix}.kind" => 'kind',
            "{$prefix}.value" => 'value',
        ];
    }
}
