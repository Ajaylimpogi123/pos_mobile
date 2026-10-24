<?php

namespace App\Actions\Errors;

use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use Carbon\CarbonImmutable;

/**
 * The error log's retention (Hardening & Pilot → B), run daily by `error-log:prune`: deletes
 * the events received more than 90 days ago, then the groups left without events.
 */
class PruneErrorLogAction
{
    public const RETENTION_DAYS = 90;

    /**
     * @return array{events: int, groups: int}
     */
    public function execute(?CarbonImmutable $now = null): array
    {
        $cutoff = ($now ?? CarbonImmutable::now())->subDays(self::RETENTION_DAYS);
        $events = 0;

        do {
            $ids = ErrorEvent::query()->where('received_at', '<', $cutoff)->orderBy('id')->limit(1000)->pluck('id');
            $events += $ids->isEmpty() ? 0 : ErrorEvent::query()->whereKey($ids->all())->delete();
        } while ($ids->count() === 1000);

        $groups = ErrorGroup::query()->whereDoesntHave('events')->delete();

        return ['events' => $events, 'groups' => (int) $groups];
    }
}
