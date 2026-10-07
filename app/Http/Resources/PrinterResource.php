<?php

namespace App\Http\Resources;

use App\Models\Printer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Printer` object (Phase 4). Load `categories` to avoid a query per
 * printer. `category_ids` lists the routed non-deleted categories, ascending, and is
 * always `[]` for a cashier printer.
 *
 * @mixin Printer
 */
class PrinterResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Printer $printer */
        $printer = $this->resource;

        return [
            'id' => $printer->id,
            'name' => $printer->name,
            'role' => $printer->role,
            'host' => $printer->host,
            'port' => (int) $printer->port,
            'paper_width_mm' => (int) $printer->paper_width_mm,
            'is_enabled' => (bool) $printer->is_enabled,
            'is_default_kitchen' => (bool) $printer->is_default_kitchen,
            'category_ids' => $printer->printsTickets() ? $printer->routedCategoryIds() : [],
            'created_at' => $printer->created_at?->toIso8601ZuluString(),
            'updated_at' => $printer->updated_at?->toIso8601ZuluString(),
        ];
    }
}
