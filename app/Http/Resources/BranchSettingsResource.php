<?php

namespace App\Http\Resources;

use App\Support\BranchSettings;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `BranchSettings` object (Phase 4): the caller's branch settings with
 * the defaults filled in. `updated_at` is null until the settings are first saved.
 *
 * @property BranchSettings $resource
 */
class BranchSettingsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $settings = $this->resource;

        return [
            'receipt_header_lines' => $settings->receiptHeaderLines(),
            'receipt_footer_lines' => $settings->receiptFooterLines(),
            'auto_print_receipt' => $settings->autoPrintReceipt(),
            'receipt_copies' => $settings->receiptCopies(),
            'print_kitchen_tickets' => $settings->printKitchenTickets(),
            'updated_at' => $settings->updatedAt()?->toIso8601ZuluString(),
        ];
    }
}
