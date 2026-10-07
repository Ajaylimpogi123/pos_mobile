<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A quick-switch PIN: a string of exactly 4–6 digits (leading zeros allowed) that is
 * not all one digit (`1111`) and not a straight ascending or descending sequence
 * (`1234`, `4321`, `123456`, `987654`). Pair it with the `string` rule (and `bail`)
 * so a JSON integer is rejected before this rule runs.
 */
class Pin implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        // `D` stops `$` from matching before a trailing newline.
        if (! is_string($value) || preg_match('/^[0-9]{4,6}$/D', $value) !== 1) {
            $fail('The :attribute must be 4 to 6 digits.');

            return;
        }

        if (self::isTrivial($value)) {
            $fail('The :attribute is too easy to guess. Avoid repeated digits and straight sequences.');
        }
    }

    /**
     * All one digit, or every step +1 (ascending) or every step −1 (descending).
     */
    public static function isTrivial(string $digits): bool
    {
        $steps = [];

        for ($i = 1, $length = strlen($digits); $i < $length; $i++) {
            $steps[(int) $digits[$i] - (int) $digits[$i - 1]] = true;
        }

        return count($steps) === 1 && in_array(array_key_first($steps), [0, 1, -1], true);
    }
}
