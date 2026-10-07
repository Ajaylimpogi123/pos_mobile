<?php

namespace App\Rules;

use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A request quantity (Ingredients, Recipes & Purchasing → A): a JSON string or number with at
 * most 3 decimals, at most 1,000,000 in size, and by default greater than 0.
 *
 * - `$allowNegative`: any non-zero value (a correction, a signed adjustment).
 * - `$allowZero`: 0 or more (a stock count, a reorder level).
 */
class DecimalQuantity implements ValidationRule
{
    public const MAX = '1000000';

    public const MESSAGE_FORMAT = 'The :attribute field must be a number with at most 3 decimals.';

    public const MESSAGE_POSITIVE = 'The :attribute field must be greater than 0.';

    public const MESSAGE_NOT_NEGATIVE = 'The :attribute field must be at least 0.';

    public const MESSAGE_NON_ZERO = 'The :attribute field must not be zero.';

    public const MESSAGE_MAX = 'The :attribute field must not be greater than 1000000.';

    public function __construct(
        private readonly bool $allowNegative = false,
        private readonly bool $allowZero = false,
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $parsed = Quantity::parseInput($value);

        if ($parsed === null) {
            $fail(self::MESSAGE_FORMAT);

            return;
        }

        $qty = BigDecimal::of($parsed);

        if ($qty->isZero() && ! $this->allowZero) {
            $fail($this->allowNegative ? self::MESSAGE_NON_ZERO : self::MESSAGE_POSITIVE);
        } elseif ($qty->isNegative() && ! $this->allowNegative) {
            $fail($this->allowZero ? self::MESSAGE_NOT_NEGATIVE : self::MESSAGE_POSITIVE);
        } elseif ($qty->abs()->isGreaterThan(self::MAX)) {
            $fail(self::MESSAGE_MAX);
        }
    }
}
