<?php

namespace App\Support\Errors;

/**
 * The error-log fingerprint (Hardening & Pilot → B):
 * `sha1(source + level + normalised message + top stack frame)`, where the normalised
 * message has ULIDs and digits replaced by `#` (ULIDs first, since they contain digits).
 */
final class ErrorFingerprint
{
    private const ULID = '/\b[0-7][0-9A-HJKMNP-TV-Z]{25}\b/i';

    public static function of(string $source, string $level, string $message, string $topFrame): string
    {
        return sha1($source."\n".$level."\n".self::normalise($message)."\n".$topFrame);
    }

    /**
     * The message with each ULID and each run of digits replaced by `#`.
     */
    public static function normalise(string $message): string
    {
        return (string) preg_replace('/\d+/', '#', (string) preg_replace(self::ULID, '#', $message));
    }

    /**
     * The top frame of a JavaScript stack: the first line that is a frame (`at fn (file:1:2)`
     * in V8/Hermes, `fn@file:1:2` in Firefox/Safari), trimmed; an empty string when none.
     */
    public static function topFrameOf(?string $stack): string
    {
        if ($stack === null || $stack === '') {
            return '';
        }

        foreach (preg_split('/\R/', $stack) ?: [] as $line) {
            $line = trim($line);

            if (preg_match('/^at\s/', $line) === 1 || (str_contains($line, '@') && preg_match('/:\d+(:\d+)?\)?$/', $line) === 1)) {
                return mb_substr($line, 0, 500);
            }
        }

        return '';
    }
}
