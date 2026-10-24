<?php

namespace App\Http\Resources;

use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * `ErrorGroup` (Hardening & Pilot → B): an item of GET /api/v1/admin/error-log and the 200 body
 * of resolve / reopen; with the `visibleEvents` relation loaded (the detail), `ErrorGroupDetail`
 * adds `events`. `latest` is the newest occurrence the caller can see (App\Actions\Errors\
 * ErrorLogQuery sets the `latestEvent` relation).
 *
 * @mixin ErrorGroup
 */
class ErrorGroupResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ErrorGroup $group */
        $group = $this->resource;
        /** @var User|null $resolver */
        $resolver = $group->resolved_by !== null ? $group->resolver : null;

        $data = [
            'id' => $group->id,
            'source' => $group->source,
            'level' => $group->level,
            'message' => $group->message,
            'status' => $group->status,
            'occurrences' => $group->occurrences,
            'first_seen_at' => $group->first_seen_at->toIso8601ZuluString(),
            'last_seen_at' => $group->last_seen_at->toIso8601ZuluString(),
            'app_versions' => array_values($group->app_versions ?? []),
            'resolved_at' => $group->resolved_at?->toIso8601ZuluString(),
            'resolved_by' => ErrorEventResource::userRef($resolver),
            'latest' => $this->latest($group),
        ];

        if ($group->relationLoaded('visibleEvents')) {
            /** @var Collection<int, ErrorEvent> $events */
            $events = $group->getRelation('visibleEvents');
            $data['events'] = ErrorEventResource::collection($events)->toArray($request);
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    private function latest(ErrorGroup $group): array
    {
        /** @var ErrorEvent|null $event */
        $event = $group->relationLoaded('latestEvent') ? $group->getRelation('latestEvent') : null;

        if ($event === null) {
            // Only while the events are being pruned: the group's own last occurrence time.
            return [
                'occurred_at' => $group->last_seen_at->toIso8601ZuluString(),
                'screen' => null,
                'app_version' => null,
                'device' => null,
                'user' => null,
            ];
        }

        $context = $event->context ?? [];

        return [
            'occurred_at' => $event->occurred_at->toIso8601ZuluString(),
            'screen' => isset($context['screen']) ? (string) $context['screen'] : null,
            'app_version' => isset($context['app_version']) ? (string) $context['app_version'] : null,
            'device' => ErrorEventResource::deviceRef($event->device),
            'user' => ErrorEventResource::userRef($event->user),
        ];
    }
}
