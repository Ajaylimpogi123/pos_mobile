<?php

namespace App\Support;

use App\Models\Branch;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * Times in the reservation messages (Table Management → E), e.g. `7:00 PM`: the instant in
 * the branch's timezone.
 */
final class ReservationTime
{
    public static function label(DateTimeInterface $at, ?Branch $branch): string
    {
        return CarbonImmutable::instance($at)
            ->setTimezone($branch?->timezone ?: BusinessDay::DEFAULT_TIMEZONE)
            ->format('g:i A');
    }
}
