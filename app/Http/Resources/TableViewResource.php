<?php

namespace App\Http\Resources;

use App\Models\DiningTable;
use App\Models\TabItem;
use App\Models\TableReservation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET /api/v1/tables (Dine-in Tables & Tabs → C): an active table and the
 * summary of its open tab (`null` when the table is free). Load `openTab.opener` and
 * `openTab.items`. `item_count` = Σ remaining_qty; `remaining_cents` = Σ unit price ×
 * remaining_qty (before discounts and service charge, display only).
 *
 * Table Management: the floor plan fields (§B), the tab's `last_round_at` (the newest line's
 * send time, §D), and `reservation` (§E): the `nextReservation` relation set by the
 * controller (the earliest booked one whose slot hasn't ended, within the next 24 hours, with
 * its hold set), or null.
 *
 * @mixin DiningTable
 */
class TableViewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var DiningTable $table */
        $table = $this->resource;
        $tab = $table->openTab;

        /** @var TableReservation|null $reservation */
        $reservation = $table->relationLoaded('nextReservation') ? $table->getRelation('nextReservation') : null;

        return [
            'id' => $table->id,
            'name' => $table->name,
            'area' => $table->area,
            'seats' => $table->seats,
            'pos_x' => $table->pos_x,
            'pos_y' => $table->pos_y,
            'width' => $table->width,
            'height' => $table->height,
            'shape' => $table->shape,
            'tab' => $tab === null ? null : [
                'ulid' => $tab->ulid,
                'guests' => $tab->guests,
                'opened_at' => $tab->opened_at->toIso8601ZuluString(),
                'opened_by' => ['id' => $tab->opener->id, 'name' => $tab->opener->name],
                'item_count' => $tab->remainingQty(),
                'remaining_cents' => $tab->remainingCents(),
                'rounds_count' => $tab->rounds_count,
                'last_round_at' => $tab->items
                    ->max(fn (TabItem $item) => $item->added_at)
                    ?->toIso8601ZuluString(),
                'updated_at' => $tab->updated_at->toIso8601ZuluString(),
            ],
            'reservation' => $reservation === null ? null : [
                'ulid' => $reservation->ulid,
                'guest_name' => $reservation->guest_name,
                'party_size' => $reservation->party_size,
                'reserved_for' => $reservation->reserved_for->toIso8601ZuluString(),
                'is_held' => $reservation->isHeld(),
                'is_late' => $reservation->isLate(),
            ],
        ];
    }
}
