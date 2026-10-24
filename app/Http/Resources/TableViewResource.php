<?php

namespace App\Http\Resources;

use App\Models\DiningTable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item of GET /api/v1/tables (Dine-in Tables & Tabs → C): an active table and the
 * summary of its open tab (`null` when the table is free). Load `openTab.opener` and
 * `openTab.items`. `item_count` = Σ remaining_qty; `remaining_cents` = Σ unit price ×
 * remaining_qty (before discounts and service charge, display only).
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

        return [
            'id' => $table->id,
            'name' => $table->name,
            'area' => $table->area,
            'seats' => $table->seats,
            'tab' => $tab === null ? null : [
                'ulid' => $tab->ulid,
                'guests' => $tab->guests,
                'opened_at' => $tab->opened_at->toIso8601ZuluString(),
                'opened_by' => ['id' => $tab->opener->id, 'name' => $tab->opener->name],
                'item_count' => $tab->remainingQty(),
                'remaining_cents' => $tab->remainingCents(),
                'rounds_count' => $tab->rounds_count,
                'updated_at' => $tab->updated_at->toIso8601ZuluString(),
            ],
        ];
    }
}
