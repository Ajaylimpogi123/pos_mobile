<?php

namespace App\Http\Resources;

use App\Models\Order;
use App\Models\Tab;
use App\Models\TabItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Tab` object (Dine-in Tables & Tabs → D). Load Tab::RESOURCE_RELATIONS.
 * `items` are by round, then id; `orders` (the settlements) oldest first;
 * `remaining_cents` = Σ unit price × remaining_qty.
 *
 * @mixin Tab
 */
class TabResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Tab $tab */
        $tab = $this->resource;

        return [
            'ulid' => $tab->ulid,
            'status' => $tab->status,
            'table' => ['id' => $tab->table->id, 'name' => $tab->table->name, 'area' => $tab->table->area],
            'guests' => $tab->guests,
            'customer' => $tab->customer === null
                ? null
                : ['id' => $tab->customer->id, 'full_name' => $tab->customer->full_name],
            'notes' => $tab->notes,
            'opened_at' => $tab->opened_at->toIso8601ZuluString(),
            'opened_by' => ['id' => $tab->opener->id, 'name' => $tab->opener->name],
            'closed_at' => $tab->closed_at?->toIso8601ZuluString(),
            'merged_into_ulid' => $tab->mergedInto?->ulid,
            'rounds_count' => $tab->rounds_count,
            'items' => $tab->items->map(fn (TabItem $item) => [
                'id' => $item->id,
                'round_no' => $item->round_no,
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'category_id' => $item->category_id,
                'unit_price_cents' => $item->unit_price_cents,
                'is_vatable' => $item->is_vatable,
                'qty' => $item->qty,
                'settled_qty' => $item->settled_qty,
                'cancelled_qty' => $item->cancelled_qty,
                'remaining_qty' => $item->remainingQty(),
                'notes' => $item->notes,
                'added_at' => $item->added_at->toIso8601ZuluString(),
                'added_by' => ['id' => $item->adder->id, 'name' => $item->adder->name],
            ])->values()->all(),
            'orders' => $tab->orders->map(fn (Order $order) => [
                'ulid' => $order->ulid,
                'invoice_no' => $order->invoice_no,
                'total_cents' => $order->total_cents,
            ])->values()->all(),
            'remaining_cents' => $tab->remainingCents(),
            'updated_at' => $tab->updated_at->toIso8601ZuluString(),
        ];
    }
}
