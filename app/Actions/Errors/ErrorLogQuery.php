<?php

namespace App\Actions\Errors;

use App\Models\Branch;
use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use App\Models\User;
use App\Support\SearchPattern;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * The error log as a `system.manage` holder sees it (Hardening & Pilot → B).
 *
 * Visibility: server groups, and app groups with an event that has no branch, are visible to
 * every holder; other app groups only when they have an event in the caller's branch, unless
 * the caller has `branch.all`. Within an app group the caller sees the events of their branch
 * and those without a branch (`latest` and the detail's `events` use the same rule).
 */
class ErrorLogQuery
{
    public const DETAIL_EVENTS = 50;

    /**
     * Visible groups, newest `last_seen_at` first, with `latest` (and the resolver) loaded.
     *
     * @param  array{status?: string|null, source?: string|null, level?: string|null, search?: string|null, from?: string|null, to?: string|null}  $filters
     * @return CursorPaginator<int, ErrorGroup>
     */
    public function paginate(User $caller, array $filters, int $perPage): CursorPaginator
    {
        $query = $this->visibleGroups($caller)
            ->with('resolver')
            ->where('status', $filters['status'] ?? ErrorGroup::STATUS_OPEN);

        foreach (['source', 'level'] as $key) {
            if (($filters[$key] ?? null) !== null) {
                $query->where($key, $filters[$key]);
            }
        }

        if (($filters['search'] ?? null) !== null) {
            $query->where('message', 'like', SearchPattern::contains((string) $filters['search']));
        }

        $timezone = $this->timezone($caller);

        if (($filters['from'] ?? null) !== null) {
            $query->where('last_seen_at', '>=', CarbonImmutable::parse((string) $filters['from'], $timezone)->startOfDay()->utc());
        }

        if (($filters['to'] ?? null) !== null) {
            $query->where('last_seen_at', '<', CarbonImmutable::parse((string) $filters['to'], $timezone)->startOfDay()->addDay()->utc());
        }

        $page = $query->orderByDesc('last_seen_at')->orderByDesc('id')->cursorPaginate($perPage)->withQueryString();

        $this->loadLatest($caller, new Collection($page->items()));

        return $page;
    }

    /**
     * `meta.summary`: the caller's visible groups that are open, open and fatal, and seen in the
     * last 24 hours (any status). Filters don't apply.
     *
     * @return array{open: int, open_fatal: int, last_24h: int}
     */
    public function summary(User $caller): array
    {
        $since = CarbonImmutable::now()->subDay();

        $row = $this->visibleGroups($caller)
            ->toBase()
            ->selectRaw('COALESCE(SUM(status = ?), 0) AS open', [ErrorGroup::STATUS_OPEN])
            ->selectRaw('COALESCE(SUM(status = ? AND level = ?), 0) AS open_fatal', [ErrorGroup::STATUS_OPEN, 'fatal'])
            ->selectRaw('COALESCE(SUM(last_seen_at >= ?), 0) AS last_24h', [$since])
            ->first();

        return [
            'open' => (int) ($row->open ?? 0),
            'open_fatal' => (int) ($row->open_fatal ?? 0),
            'last_24h' => (int) ($row->last_24h ?? 0),
        ];
    }

    /**
     * A visible group, or null (the route answers 404).
     */
    public function findVisible(User $caller, int|string $id): ?ErrorGroup
    {
        if (! ctype_digit((string) $id)) {
            return null;
        }

        return $this->visibleGroups($caller)->whereKey((int) $id)->first();
    }

    /**
     * Load what a list item shows: the resolver and `latest`.
     */
    public function loadSummaryRelations(User $caller, ErrorGroup $group): ErrorGroup
    {
        $group->load('resolver');
        $this->loadLatest($caller, new Collection([$group]));

        return $group;
    }

    /**
     * Load the group's `latest` and its newest 50 visible events (as `visibleEvents`).
     */
    public function loadDetail(User $caller, ErrorGroup $group): ErrorGroup
    {
        $group->loadMissing('resolver');
        $this->loadLatest($caller, new Collection([$group]));

        $events = $this->visibleEvents($caller, $group->source === ErrorGroup::SOURCE_SERVER ? [$group->id] : [])
            ->where('error_group_id', $group->id)
            ->with(['device', 'user'])
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->limit(self::DETAIL_EVENTS)
            ->get();

        return $group->setRelation('visibleEvents', $events);
    }

    /**
     * @return Builder<ErrorGroup>
     */
    private function visibleGroups(User $caller): Builder
    {
        $query = ErrorGroup::query();

        if ($caller->hasPermission('branch.all')) {
            return $query;
        }

        $branchId = (int) $caller->branch_id;

        return $query->where(fn (Builder $q) => $q
            ->where('source', ErrorGroup::SOURCE_SERVER)
            ->orWhereHas('events', fn (Builder $events) => $events
                ->where(fn (Builder $e) => $e->whereNull('branch_id')->orWhere('branch_id', $branchId))));
    }

    /**
     * Events the caller may see: every event of the given server groups and with `branch.all`;
     * otherwise those of the caller's branch or without a branch.
     *
     * @param  list<int>  $serverGroupIds
     * @return Builder<ErrorEvent>
     */
    private function visibleEvents(User $caller, array $serverGroupIds): Builder
    {
        $query = ErrorEvent::query();

        if ($caller->hasPermission('branch.all')) {
            return $query;
        }

        $branchId = (int) $caller->branch_id;

        return $query->where(function (Builder $q) use ($branchId, $serverGroupIds) {
            $q->whereNull('branch_id')->orWhere('branch_id', $branchId);

            if ($serverGroupIds !== []) {
                $q->orWhereIn('error_group_id', $serverGroupIds);
            }
        });
    }

    /**
     * Sets each group's `latestEvent` relation: its newest visible event (by `occurred_at`, then
     * id), with the device and user, in one query.
     *
     * @param  Collection<int, ErrorGroup>  $groups
     */
    private function loadLatest(User $caller, Collection $groups): void
    {
        if ($groups->isEmpty()) {
            return;
        }

        $serverIds = $groups->where('source', ErrorGroup::SOURCE_SERVER)->modelKeys();

        $ranked = $this->visibleEvents($caller, array_values(array_map('intval', $serverIds)))
            ->whereIn('error_group_id', $groups->modelKeys())
            ->select('error_events.*')
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY error_group_id ORDER BY occurred_at DESC, id DESC) AS rank_in_group');

        $latest = ErrorEvent::query()
            ->fromSub($ranked, 'error_events')
            ->where('rank_in_group', 1)
            ->with(['device', 'user'])
            ->get()
            ->keyBy('error_group_id');

        foreach ($groups as $group) {
            $group->setRelation('latestEvent', $latest->get($group->id));
        }
    }

    private function timezone(User $caller): string
    {
        $timezone = Branch::withTrashed()->whereKey($caller->branch_id)->value('timezone');

        return is_string($timezone) && $timezone !== '' ? $timezone : 'UTC';
    }
}
