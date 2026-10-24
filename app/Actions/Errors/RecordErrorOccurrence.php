<?php

namespace App\Actions\Errors;

use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use App\Support\Errors\ErrorFingerprint;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Records one occurrence in the error log (Hardening & Pilot → B), for the app
 * (POST /client-errors) and the server (5xx capture):
 * - ignores it when an event with the same `ulid` exists (returns false);
 * - upserts the group by fingerprint: `occurrences + 1`, the first/last seen times, the last
 *   5 distinct app versions (newest first), and reopens it when it was resolved;
 * - inserts the event.
 * One transaction per occurrence, with the group row locked.
 */
class RecordErrorOccurrence
{
    /**
     * @param  array<string, mixed>  $context  already reduced to the contract's keys
     * @return bool true when stored, false for a duplicate ulid
     */
    public function execute(
        string $ulid,
        string $source,
        string $level,
        string $message,
        ?string $stack,
        string $topFrame,
        CarbonImmutable $occurredAt,
        array $context,
        ?int $branchId,
        ?int $userId,
        ?int $deviceId,
    ): bool {
        $attempt = fn (): bool => $this->record($ulid, $source, $level, $message, $stack, $topFrame, $occurredAt, $context, $branchId, $userId, $deviceId);

        try {
            return $attempt();
        } catch (UniqueConstraintViolationException) {
            // A concurrent request inserted the same group or the same ulid first: retry once,
            // which now finds the group (or reports the duplicate).
            return $attempt();
        }
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function record(
        string $ulid,
        string $source,
        string $level,
        string $message,
        ?string $stack,
        string $topFrame,
        CarbonImmutable $occurredAt,
        array $context,
        ?int $branchId,
        ?int $userId,
        ?int $deviceId,
    ): bool {
        return DB::transaction(function () use ($ulid, $source, $level, $message, $stack, $topFrame, $occurredAt, $context, $branchId, $userId, $deviceId): bool {
            if (ErrorEvent::query()->where('ulid', $ulid)->exists()) {
                return false;
            }

            $fingerprint = ErrorFingerprint::of($source, $level, $message, $topFrame);
            $now = CarbonImmutable::now();

            $group = ErrorGroup::query()->where('fingerprint', $fingerprint)->lockForUpdate()->first()
                ?? new ErrorGroup([
                    'fingerprint' => $fingerprint,
                    'source' => $source,
                    'level' => $level,
                    'message' => $message,
                    'first_seen_at' => $occurredAt,
                    'last_seen_at' => $occurredAt,
                    'app_versions' => [],
                ]);

            $group->occurrences = $group->occurrences + 1;

            if ($occurredAt->lt($group->first_seen_at)) {
                $group->first_seen_at = $occurredAt;
            }

            if ($occurredAt->gt($group->last_seen_at)) {
                $group->last_seen_at = $occurredAt;
            }

            $appVersion = $context['app_version'] ?? null;

            if (is_string($appVersion) && $appVersion !== '') {
                $versions = array_values(array_filter($group->app_versions ?? [], fn ($v) => $v !== $appVersion));
                $group->app_versions = array_slice([$appVersion, ...$versions], 0, ErrorGroup::MAX_APP_VERSIONS);
            }

            // A resolved group reopens automatically on a new occurrence.
            if ($group->status === ErrorGroup::STATUS_RESOLVED) {
                $group->status = ErrorGroup::STATUS_OPEN;
                $group->resolved_at = null;
                $group->resolved_by = null;
            }

            $group->save();

            ErrorEvent::query()->create([
                'ulid' => $ulid,
                'error_group_id' => $group->id,
                'branch_id' => $branchId,
                'user_id' => $userId,
                'device_id' => $deviceId,
                'occurred_at' => $occurredAt,
                'received_at' => $now,
                'message' => $message,
                'stack' => $stack,
                'context' => $context === [] ? null : $context,
            ]);

            return true;
        }, 3);
    }
}
