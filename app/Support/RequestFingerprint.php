<?php

namespace App\Support;

/**
 * The fingerprint of an idempotent request body (Global Conventions, *Idempotent
 * requests*): bodies are compared as decoded JSON, ignoring key order and any `pin`
 * field. Only this hash is stored, never the body, so a PIN never reaches storage.
 */
final class RequestFingerprint
{
    /**
     * Keys dropped at any depth before hashing.
     */
    private const IGNORED_KEYS = ['pin'];

    /**
     * @param  array<array-key, mixed>  $body  The decoded body
     */
    public static function of(array $body): string
    {
        return hash('sha256', json_encode(
            self::canonical($body),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        ));
    }

    /**
     * Objects get their keys sorted (and ignored keys removed), recursively; lists keep
     * their order.
     *
     * @param  array<array-key, mixed>  $value
     * @return array<array-key, mixed>
     */
    private static function canonical(array $value): array
    {
        $isList = array_is_list($value);

        if (! $isList) {
            foreach (self::IGNORED_KEYS as $key) {
                unset($value[$key]);
            }

            ksort($value, SORT_STRING);
        }

        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $value[$key] = self::canonical($item);
            }
        }

        return $value;
    }
}
