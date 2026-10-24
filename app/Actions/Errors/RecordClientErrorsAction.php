<?php

namespace App\Actions\Errors;

use App\Models\Device;
use App\Models\ErrorGroup;
use App\Models\User;
use App\Support\Errors\ErrorFingerprint;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * POST /api/v1/client-errors (Hardening & Pilot → B): records a batch of app errors.
 *
 * - Over-long strings are truncated, never rejected (message 1000, stack 16000, the context
 *   fields to their contract lengths, `extra` to 20 keys of 500 characters). Unknown
 *   context keys are dropped.
 * - An `occurred_at` before 2000 or more than a day ahead (a tablet with an unset clock) is
 *   recorded as the time it was received.
 * - The user, branch and device come from the token when a valid one was sent; otherwise
 *   the event has none.
 * - A ulid already recorded (in the log or earlier in the batch) is a duplicate.
 */
class RecordClientErrorsAction
{
    public const MAX_MESSAGE = 1000;

    public const MAX_STACK = 16000;

    public const MAX_EXTRA_KEYS = 20;

    public const MAX_EXTRA_VALUE = 500;

    /** The contract's context strings and their lengths. */
    private const CONTEXT_STRINGS = [
        'screen' => 120,
        'app_version' => 20,
        'os' => 20,
        'os_version' => 20,
        'device_model' => 60,
    ];

    public function __construct(private readonly RecordErrorOccurrence $record) {}

    /**
     * @param  list<array<string, mixed>>  $errors  validated `ClientError`s
     * @return array{accepted: int, duplicates: int}
     */
    public function execute(array $errors, ?User $user, ?Device $device): array
    {
        $accepted = $duplicates = 0;
        $seen = [];

        foreach ($errors as $error) {
            $ulid = strtoupper((string) $error['ulid']);

            if (isset($seen[$ulid])) {
                $duplicates++;

                continue;
            }

            $seen[$ulid] = true;
            $message = self::truncate((string) $error['message'], self::MAX_MESSAGE);
            $stack = isset($error['stack']) && is_string($error['stack']) && $error['stack'] !== ''
                ? self::truncate($error['stack'], self::MAX_STACK)
                : null;

            $stored = $this->record->execute(
                ulid: $ulid,
                source: ErrorGroup::SOURCE_APP,
                level: (string) $error['level'],
                message: $message,
                stack: $stack,
                topFrame: ErrorFingerprint::topFrameOf($stack),
                occurredAt: $this->occurredAt($error['occurred_at'] ?? null),
                context: $this->context(is_array($error['context'] ?? null) ? $error['context'] : []),
                branchId: $user !== null ? (int) $user->branch_id : null,
                userId: $user?->id,
                deviceId: $device?->id,
            );

            $stored ? $accepted++ : $duplicates++;
        }

        return ['accepted' => $accepted, 'duplicates' => $duplicates];
    }

    public static function truncate(string $value, int $max): string
    {
        return mb_strlen($value) > $max ? mb_substr($value, 0, $max) : $value;
    }

    private function occurredAt(mixed $value): CarbonImmutable
    {
        $now = CarbonImmutable::now();

        try {
            $at = CarbonImmutable::parse((string) $value)->utc();
        } catch (Throwable) {
            return $now;
        }

        return $at->year < 2000 || $at->gt($now->addDay()) ? $now : $at;
    }

    /**
     * The contract's context fields only, truncated; null and empty values are dropped.
     *
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private function context(array $context): array
    {
        $kept = [];

        foreach (self::CONTEXT_STRINGS as $key => $max) {
            $value = $context[$key] ?? null;

            if (is_scalar($value) && ! is_bool($value) && (string) $value !== '') {
                $kept[$key] = self::truncate((string) $value, $max);
            }
        }

        if (isset($context['install_id']) && is_string($context['install_id'])) {
            $kept['install_id'] = strtoupper($context['install_id']);
        }

        if (isset($context['online']) && in_array($context['online'], [true, false, 0, 1, '0', '1'], true)) {
            $kept['online'] = (bool) $context['online'];
        }

        if (isset($context['extra']) && is_array($context['extra'])) {
            $extra = [];

            foreach ($context['extra'] as $key => $value) {
                if (count($extra) >= self::MAX_EXTRA_KEYS) {
                    break;
                }

                if (is_scalar($value)) {
                    $extra[self::truncate((string) $key, 60)] = self::truncate(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value, self::MAX_EXTRA_VALUE);
                }
            }

            if ($extra !== []) {
                $kept['extra'] = $extra;
            }
        }

        return $kept;
    }
}
