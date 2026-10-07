<?php

namespace App\Support\Units;

/**
 * A unit valid for an item: its canonical name (the catalog code, or the ingredient unit's
 * name as defined) and its exact factor to the item's base unit.
 */
final readonly class ResolvedUnit
{
    public function __construct(
        public string $name,
        public string $factor,
    ) {}
}
