<?php

namespace App\Actions\Shifts;

use Illuminate\Database\Eloquent\Model;

/**
 * The outcome of a shift event (open, cash movement): the stored record, and whether this
 * request created it (`201`) or repeated an event the server already had (`200`, the
 * stored result).
 *
 * @template TModel of Model
 */
final class ShiftEventResult
{
    /**
     * @param  TModel  $record
     */
    private function __construct(
        public readonly Model $record,
        public readonly bool $created,
    ) {}

    /**
     * @template T of Model
     *
     * @param  T  $record
     * @return self<T>
     */
    public static function created(Model $record): self
    {
        return new self($record, true);
    }

    /**
     * @template T of Model
     *
     * @param  T  $record
     * @return self<T>
     */
    public static function repeated(Model $record): self
    {
        return new self($record, false);
    }
}
