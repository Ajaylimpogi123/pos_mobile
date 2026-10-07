<?php

namespace App\Support;

/**
 * Builds SQL LIKE patterns from user input.
 */
final class SearchPattern
{
    /**
     * A "contains" pattern with LIKE wildcards (`%`, `_`) and the escape
     * character (`\`) in the term matched literally.
     */
    public static function contains(string $term): string
    {
        return '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';
    }
}
