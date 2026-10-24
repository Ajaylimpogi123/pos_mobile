<?php

namespace App\Http\Resources;

use App\Models\PrintJob;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `PrintJob` object (Web POS & Print Bridge → D). Load `printer` (it
 * includes soft-deleted printers, so `printer_name` is always known). The payload is never
 * shown.
 *
 * @mixin PrintJob
 */
class PrintJobResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var PrintJob $job */
        $job = $this->resource;

        return [
            'ulid' => $job->ulid,
            'printer_id' => $job->printer_id,
            'printer_name' => $job->printer?->name,
            'kind' => $job->kind,
            'order_ulid' => $job->order_ulid,
            'copy_no' => $job->copy_no,
            'is_reprint' => $job->is_reprint,
            'status' => $job->status,
            'attempts' => $job->attempts,
            'last_error' => $job->last_error,
            'created_at' => $job->created_at?->toIso8601ZuluString(),
            'printed_at' => $job->printed_at?->toIso8601ZuluString(),
        ];
    }
}
