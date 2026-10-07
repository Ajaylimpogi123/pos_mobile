<?php

use App\Support\BusinessDay;
use Carbon\CarbonImmutable;

function utc(string $time): CarbonImmutable
{
    return CarbonImmutable::parse($time, 'UTC');
}

describe('dateOf (Asia/Manila, day starts 04:00)', function () {
    beforeEach(function () {
        $this->day = new BusinessDay('Asia/Manila', '04:00:00');
    });

    it('keeps 03:59 local on the previous business day and rolls over at 04:00', function () {
        // 2026-09-25 03:59:59 / 04:00:00 in Manila (UTC+8).
        expect($this->day->dateOf(utc('2026-09-24 19:59:59')))->toBe('2026-09-24')
            ->and($this->day->dateOf(utc('2026-09-24 20:00:00')))->toBe('2026-09-25');
    });

    it('does not roll over at local midnight', function () {
        // 2026-09-25 00:00 in Manila is still business day the 24th.
        expect($this->day->dateOf(utc('2026-09-24 16:00:00')))->toBe('2026-09-24');
    });

    it('does not roll over at UTC midnight', function () {
        // 07:59:59 and 08:00:00 in Manila on the 25th: both business day the 25th.
        expect($this->day->dateOf(utc('2026-09-24 23:59:59')))->toBe('2026-09-25')
            ->and($this->day->dateOf(utc('2026-09-25 00:00:00')))->toBe('2026-09-25');
    });

    it('accepts an HH:MM day start and a non-UTC instant', function () {
        $day = new BusinessDay('Asia/Manila', '04:00');

        expect($day->dateOf(CarbonImmutable::parse('2026-09-25 03:59:59', 'Asia/Manila')))->toBe('2026-09-24')
            ->and($day->dateOf(CarbonImmutable::parse('2026-09-25 04:00:00', 'Asia/Manila')))->toBe('2026-09-25');
    });
});

describe('range', function () {
    it('is the UTC half-open range from day start to the next day start', function () {
        $range = (new BusinessDay('Asia/Manila', '04:00:00'))->range('2026-09-24');

        expect($range['start']->toIso8601ZuluString())->toBe('2026-09-23T20:00:00Z')
            ->and($range['end']->toIso8601ZuluString())->toBe('2026-09-24T20:00:00Z')
            ->and($range['start']->getTimezone()->getName())->toBe('UTC');
    });

    it('is 23 hours long on a spring-forward day', function () {
        // New York moves from EST (UTC-5) to EDT (UTC-4) at 02:00 on 2026-03-08.
        $range = (new BusinessDay('America/New_York', '04:00:00'))->range('2026-03-07');

        expect($range['start']->toIso8601ZuluString())->toBe('2026-03-07T09:00:00Z')
            ->and($range['end']->toIso8601ZuluString())->toBe('2026-03-08T08:00:00Z');
    });
});

describe('lastDays', function () {
    it('returns the last 7 business days including today, oldest first, contiguous', function () {
        $days = (new BusinessDay('Asia/Manila', '04:00:00'))->lastDays(7, utc('2026-09-24 03:30:00'));

        expect(array_column($days, 'date'))->toBe([
            '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
        ])
            ->and($days[0]['start']->toIso8601ZuluString())->toBe('2026-09-17T20:00:00Z')
            ->and($days[6]['end']->toIso8601ZuluString())->toBe('2026-09-24T20:00:00Z');

        foreach (range(1, 6) as $i) {
            expect($days[$i]['start']->equalTo($days[$i - 1]['end']))->toBeTrue();
        }
    });

    it('ends on the previous calendar date before the day start', function () {
        // 2026-09-25 03:59 in Manila: today is still business day the 24th.
        $days = (new BusinessDay('Asia/Manila', '04:00:00'))->lastDays(7, utc('2026-09-24 19:59:00'));

        expect($days[0]['date'])->toBe('2026-09-18')
            ->and($days[6]['date'])->toBe('2026-09-24');
    });
});
