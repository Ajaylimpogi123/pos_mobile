<?php

namespace App\Http\Resources;

use App\Models\Shift;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Shift` object (Phase 6). Load `device`, `opener` and `closer`, and compute
 * the report first (App\Actions\Shifts\BuildShiftReports, one batch for a whole page).
 * `closed_*`, `counted_cash_cents` and `close_note` are `null` while the shift is open;
 * `flags` is `[]` when there are none.
 *
 * @mixin Shift
 */
class ShiftResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Shift $shift */
        $shift = $this->resource;

        return [
            'ulid' => $shift->ulid,
            'status' => $shift->status(),
            'device' => ['id' => $shift->device->id, 'code' => $shift->device->code],
            'opened_at' => $shift->opened_at->toIso8601ZuluString(),
            'opened_by' => ['id' => $shift->opener->id, 'name' => $shift->opener->name],
            'opening_float_cents' => $shift->opening_float_cents,
            'closed_at' => $shift->closed_at?->toIso8601ZuluString(),
            'closed_by' => $shift->closer === null
                ? null
                : ['id' => $shift->closer->id, 'name' => $shift->closer->name],
            'counted_cash_cents' => $shift->counted_cash_cents,
            'close_note' => $shift->close_note,
            'flags' => array_values($shift->flags ?? []),
            'report' => $shift->computedReport(),
            'synced_at' => $shift->synced_at->toIso8601ZuluString(),
        ];
    }
}
