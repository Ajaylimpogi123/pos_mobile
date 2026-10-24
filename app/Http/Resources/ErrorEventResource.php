<?php

namespace App\Http\Resources;

use App\Models\Device;
use App\Models\ErrorEvent;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use stdClass;

/**
 * `ErrorEvent` (Hardening & Pilot → B): one occurrence in GET /api/v1/admin/error-log/{group}:
 * `{ ulid, occurred_at, received_at, message, stack, context, device, user }`. `context` is
 * always an object (`{}` when empty).
 *
 * @mixin ErrorEvent
 */
class ErrorEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ErrorEvent $event */
        $event = $this->resource;

        return [
            'ulid' => $event->ulid,
            'occurred_at' => $event->occurred_at->toIso8601ZuluString(),
            'received_at' => $event->received_at->toIso8601ZuluString(),
            'message' => $event->message,
            'stack' => $event->stack,
            'context' => self::context($event->context),
            'device' => self::deviceRef($event->device),
            'user' => self::userRef($event->user),
        ];
    }

    /**
     * @param  array<string, mixed>|null  $context
     * @return array<string, mixed>|stdClass
     */
    public static function context(?array $context): array|stdClass
    {
        if ($context === null || $context === []) {
            return new stdClass;
        }

        if (isset($context['extra']) && is_array($context['extra'])) {
            $context['extra'] = (object) $context['extra'];
        }

        return $context;
    }

    /**
     * @return array{id: int, code: string, name: string}|null
     */
    public static function deviceRef(?Device $device): ?array
    {
        return $device !== null ? ['id' => $device->id, 'code' => $device->code, 'name' => $device->name] : null;
    }

    /**
     * @return array{id: int, name: string}|null
     */
    public static function userRef(?User $user): ?array
    {
        return $user !== null ? ['id' => $user->id, 'name' => $user->name] : null;
    }
}
