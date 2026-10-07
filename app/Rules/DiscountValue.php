<?php

namespace App\Rules;

use App\Support\Sales\Discount;
use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;

/**
 * The `value` of a discount object, whose range depends on the sibling `kind`:
 * `percent` → 1–10000 (basis points), `amount` → 1–1000000000 (centavos). Pair it with
 * `integer:strict` (and `bail`). An invalid `kind` is reported on `kind` only.
 */
class DiscountValue implements DataAwareRule, ValidationRule
{
    /**
     * @var array<string, mixed>
     */
    private array $data = [];

    /**
     * @param  array<string, mixed>  $data
     */
    public function setData(array $data): static
    {
        $this->data = $data;

        return $this;
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $kind = Arr::get($this->data, Str::beforeLast($attribute, '.').'.kind');

        $max = match ($kind) {
            Discount::KIND_PERCENT => Discount::MAX_PERCENT_BPS,
            Discount::KIND_AMOUNT => Discount::MAX_AMOUNT_CENTS,
            default => null,
        };

        if ($max !== null && is_int($value) && ($value < 1 || $value > $max)) {
            $fail('validation.between.numeric')->translate(['min' => 1, 'max' => $max]);
        }
    }
}
