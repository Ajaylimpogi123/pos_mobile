<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A printer's `host`: an IPv4 address or a hostname (letters, digits, hyphens and dots),
 * with no scheme, no port and no path. Hostname labels are 1–63 characters and do not
 * start or end with a hyphen. A value made only of digits and dots must be a valid IPv4
 * address (so `192.168.1.300` is rejected). Pair it with `string` and `max:253` (and
 * `bail`), which report the other failures.
 */
class PrinterHost implements ValidationRule
{
    public const MESSAGE = 'The :attribute must be an IPv4 address or a hostname, with no scheme or port.';

    /**
     * `D`: `$` must not match before a trailing newline.
     */
    private const HOSTNAME = '/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/D';

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! self::isValid($value)) {
            $fail(self::MESSAGE);
        }
    }

    public static function isValid(string $host): bool
    {
        if (preg_match('/^[0-9.]+$/D', $host) === 1) {
            return filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
        }

        return strlen($host) <= 253 && preg_match(self::HOSTNAME, $host) === 1;
    }
}
