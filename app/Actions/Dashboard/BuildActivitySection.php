<?php

namespace App\Actions\Dashboard;

use App\Models\AuditLog;
use App\Support\BusinessDay;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The dashboard `activity` section: audit entries whose actor belongs to the branch
 * (soft-deleted actors included: what they did still happened in the branch).
 *
 * - `logins_by_day` counts `auth.login`; `changes_by_day` counts everything except `auth.*`
 *   and (since Phase 3) `order.*`: sales are in the `sales` section, not the feed; since
 *   Phase 6 also `shift.*` (shifts have their own screen); since Ingredients, Recipes &
 *   Purchasing also `pr.*` and `po.*` (purchasing has its own timelines).
 *   Both always have exactly 7 business days (oldest first, 0-filled), computed in a
 *   single query with one conditional SUM per day and series, over the 7-day window.
 * - `recent_changes`: the 8 newest entries other than `auth.*`, `order.*`, `shift.*`, `pr.*` and `po.*` (one query),
 *   with a server-built `summary` (one query per subject type, see DescribeAuditEntries).
 */
class BuildActivitySection
{
    public const DAYS = 7;

    public const RECENT_CHANGES_LIMIT = 8;

    public const UNKNOWN_ACTOR = 'Unknown user';

    public function __construct(private readonly DescribeAuditEntries $describe) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(int $branchId, BusinessDay $businessDay, CarbonImmutable $now): array
    {
        $days = $businessDay->lastDays(self::DAYS, $now);

        $counts = $this->branchEntries($branchId)
            ->where('audit_logs.created_at', '>=', $this->sqlTime($days[0]['start']))
            ->where('audit_logs.created_at', '<', $this->sqlTime($days[self::DAYS - 1]['end']));

        foreach ($days as $i => $day) {
            $range = [$this->sqlTime($day['start']), $this->sqlTime($day['end'])];

            $counts->selectRaw(
                "SUM(audit_logs.action = 'auth.login' AND audit_logs.created_at >= ? AND audit_logs.created_at < ?) AS logins_{$i}",
                $range,
            )->selectRaw(
                "SUM(audit_logs.action NOT LIKE 'auth.%' AND audit_logs.action NOT LIKE 'order.%' AND audit_logs.action NOT LIKE 'shift.%'"
                ." AND audit_logs.action NOT LIKE 'pr.%' AND audit_logs.action NOT LIKE 'po.%'"
                ." AND audit_logs.created_at >= ? AND audit_logs.created_at < ?) AS changes_{$i}",
                $range,
            );
        }

        $row = (array) $counts->first();

        $loginsByDay = [];
        $changesByDay = [];

        foreach ($days as $i => $day) {
            $loginsByDay[] = ['date' => $day['date'], 'count' => (int) ($row["logins_{$i}"] ?? 0)];
            $changesByDay[] = ['date' => $day['date'], 'count' => (int) ($row["changes_{$i}"] ?? 0)];
        }

        return [
            'logins_by_day' => $loginsByDay,
            'changes_by_day' => $changesByDay,
            'recent_changes' => $this->recentChanges($branchId),
        ];
    }

    /**
     * @return list<array{id: int, action: string, summary: string, actor_name: string, created_at: string|null}>
     */
    private function recentChanges(int $branchId): array
    {
        $entries = AuditLog::query()
            ->join('users', 'users.id', '=', 'audit_logs.actor_id')
            ->where('users.branch_id', $branchId)
            ->where('audit_logs.action', 'not like', 'auth.%')
            ->where('audit_logs.action', 'not like', 'order.%')
            ->where('audit_logs.action', 'not like', 'shift.%')
            ->where('audit_logs.action', 'not like', 'pr.%')
            ->where('audit_logs.action', 'not like', 'po.%')
            ->select([
                'audit_logs.id', 'audit_logs.action', 'audit_logs.subject_type', 'audit_logs.subject_id',
                'audit_logs.changes', 'audit_logs.created_at', 'users.name AS actor_name',
            ])
            ->orderByDesc('audit_logs.created_at')
            ->orderByDesc('audit_logs.id')
            ->limit(self::RECENT_CHANGES_LIMIT)
            ->get();

        $summaries = $this->describe->execute($entries);

        return $entries
            ->map(function (AuditLog $entry) use ($summaries) {
                $actorName = $entry->getAttribute('actor_name');

                return [
                    'id' => $entry->id,
                    'action' => $entry->action,
                    'summary' => $summaries[$entry->id],
                    'actor_name' => is_string($actorName) && $actorName !== '' ? $actorName : self::UNKNOWN_ACTOR,
                    'created_at' => $entry->created_at?->toIso8601ZuluString(),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * Audit entries whose actor belongs to the branch (raw query builder, no select yet).
     */
    private function branchEntries(int $branchId): Builder
    {
        return DB::table('audit_logs')
            ->join('users', 'users.id', '=', 'audit_logs.actor_id')
            ->where('users.branch_id', $branchId);
    }

    /**
     * Timestamps are stored in UTC (app timezone), formatted as MySQL DATETIME literals.
     */
    private function sqlTime(CarbonImmutable $instant): string
    {
        return $instant->utc()->toDateTimeString();
    }
}
