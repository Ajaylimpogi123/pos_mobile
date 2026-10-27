<?php

namespace App\Http\Requests\Reservations;

use App\Http\Requests\Tabs\TabRules;
use Carbon\CarbonImmutable;
use Closure;
use Throwable;

/**
 * Field rules of a reservation (Table Management → E.2), shared by create and update (where
 * every field is optional):
 *
 * - `table_id`: an active table of the branch;
 * - `guest_name`: max 60 (trimmed by the global TrimStrings middleware);
 * - `phone`: nullable, max 20, `^[0-9+ ()-]+$`;
 * - `party_size`: 1–99 (it may exceed the table's seats);
 * - `reserved_for`: an ISO date-time from 15 minutes ago up to 90 days ahead
 *   (`Pick a time from now up to 90 days ahead.`);
 * - `notes`: nullable, max 255.
 */
final class ReservationRules
{
    public const MAX_GUEST_NAME = 60;

    public const MAX_PHONE = 20;

    public const MAX_PARTY_SIZE = 99;

    public const MAX_NOTES = 255;

    public const PAST_GRACE_MINUTES = 15;

    public const MAX_DAYS_AHEAD = 90;

    public const MESSAGE_WINDOW = 'Pick a time from now up to 90 days ahead.';

    /**
     * @return array<string, list<mixed>>
     */
    public static function rules(bool $store, int $branchId): array
    {
        $required = $store ? ['required'] : ['sometimes', 'required'];

        return [
            'table_id' => ['bail', ...$required, 'integer', TabRules::activeTable($branchId)],
            'guest_name' => [...$required, 'string', 'max:'.self::MAX_GUEST_NAME],
            'phone' => ['sometimes', 'nullable', 'string', 'max:'.self::MAX_PHONE, 'regex:/^[0-9+ ()-]+$/D'],
            'party_size' => [...$required, 'integer', 'min:1', 'max:'.self::MAX_PARTY_SIZE],
            'reserved_for' => ['bail', ...$required, 'string', 'date', self::window()],
            'notes' => ['sometimes', 'nullable', 'string', 'max:'.self::MAX_NOTES],
        ];
    }

    /**
     * `reserved_for` as a UTC instant, to the second.
     */
    public static function instant(string $value): CarbonImmutable
    {
        return CarbonImmutable::parse($value)->utc()->startOfSecond();
    }

    /**
     * No earlier than 15 minutes ago and at most 90 days ahead.
     */
    private static function window(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            try {
                $at = self::instant((string) $value);
            } catch (Throwable) {
                $fail(self::MESSAGE_WINDOW);

                return;
            }

            $now = CarbonImmutable::now();

            if ($at->lt($now->subMinutes(self::PAST_GRACE_MINUTES)) || $at->gt($now->addDays(self::MAX_DAYS_AHEAD))) {
                $fail(self::MESSAGE_WINDOW);
            }
        };
    }
}
