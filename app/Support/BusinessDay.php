<?php

namespace App\Support;

use App\Models\Branch;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * A branch's business day (PROJECT_MEMORY §4.4): the calendar day in the branch
 * `timezone`, rolling over at `day_start_time` instead of midnight. With Asia/Manila
 * and 04:00, 03:59 local on the 25th still belongs to business day the 24th.
 *
 * Instants are compared in UTC: a business day D covers the half-open UTC range
 * [D at day_start local, D+1 at day_start local).
 */
final class BusinessDay
{
    public const DEFAULT_TIMEZONE = 'Asia/Manila';

    public const DEFAULT_DAY_START = '04:00:00';

    private readonly string $dayStart;

    /**
     * @param  string  $dayStart  "HH:MM" or "HH:MM:SS" (local time)
     */
    public function __construct(private readonly string $timezone, string $dayStart)
    {
        $parts = array_map('intval', explode(':', $dayStart)) + [0, 0, 0];

        $this->dayStart = sprintf('%02d:%02d:%02d', $parts[0], $parts[1], $parts[2]);
    }

    public static function forBranch(?Branch $branch): self
    {
        return new self(
            $branch?->timezone ?: self::DEFAULT_TIMEZONE,
            (string) ($branch?->day_start_time ?: self::DEFAULT_DAY_START),
        );
    }

    /**
     * The business date (`YYYY-MM-DD`) an instant belongs to.
     */
    public function dateOf(DateTimeInterface $instant): string
    {
        $local = CarbonImmutable::instance($instant)->setTimezone($this->timezone);

        // Before the rollover time, the instant still belongs to the previous business day.
        // Comparing wall-clock times (not subtracting an offset) stays correct across DST.
        return $local->format('H:i:s') < $this->dayStart
            ? $local->subDay()->toDateString()
            : $local->toDateString();
    }

    /**
     * The UTC half-open range [start, end) of a business date.
     *
     * @return array{start: CarbonImmutable, end: CarbonImmutable}
     */
    public function range(string $date): array
    {
        $start = CarbonImmutable::parse("{$date} {$this->dayStart}", $this->timezone);
        $end = CarbonImmutable::parse($start->addDay()->toDateString()." {$this->dayStart}", $this->timezone);

        return ['start' => $start->utc(), 'end' => $end->utc()];
    }

    /**
     * The last `$count` business days up to and including the one `$now` belongs to,
     * oldest first, each with its UTC range.
     *
     * @return list<array{date: string, start: CarbonImmutable, end: CarbonImmutable}>
     */
    public function lastDays(int $count, DateTimeInterface $now): array
    {
        $today = CarbonImmutable::parse($this->dateOf($now));
        $days = [];

        for ($offset = $count - 1; $offset >= 0; $offset--) {
            $date = $today->subDays($offset)->toDateString();
            $days[] = ['date' => $date, ...$this->range($date)];
        }

        return $days;
    }
}
