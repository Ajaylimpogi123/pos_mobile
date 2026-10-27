<?php

namespace App\Http\Resources;

use App\Models\TableReservation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Reservation` object (Table Management → E). Load
 * TableReservation::RESOURCE_RELATIONS, and set the branch's hold with withHoldMinutes() to
 * save a query per row. `tab_ulid` is the tab it was seated into (`null` unless seated).
 *
 * @mixin TableReservation
 */
class ReservationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var TableReservation $reservation */
        $reservation = $this->resource;

        return [
            'ulid' => $reservation->ulid,
            'status' => $reservation->status,
            'table' => ['id' => $reservation->table->id, 'name' => $reservation->table->name, 'area' => $reservation->table->area],
            'guest_name' => $reservation->guest_name,
            'phone' => $reservation->phone,
            'party_size' => $reservation->party_size,
            'reserved_for' => $reservation->reserved_for->toIso8601ZuluString(),
            'business_date' => $reservation->business_date,
            'notes' => $reservation->notes,
            'is_held' => $reservation->isHeld(),
            'is_late' => $reservation->isLate(),
            'tab_ulid' => $reservation->tab?->ulid,
            'created_by' => ['id' => $reservation->creator->id, 'name' => $reservation->creator->name],
            'updated_at' => $reservation->updated_at->toIso8601ZuluString(),
        ];
    }
}
