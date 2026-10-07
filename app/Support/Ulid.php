<?php

namespace App\Support;

/**
 * The client-generated ULIDs of transactional rows (the idempotency keys): 26
 * characters of uppercase Crockford base32, the first at most `7` (Phase 3 contract).
 */
final class Ulid
{
    /**
     * `D`: `$` must not match before a trailing newline.
     */
    public const PATTERN = '/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/D';

    public static function isValid(mixed $value): bool
    {
        return is_string($value) && preg_match(self::PATTERN, $value) === 1;
    }
}
