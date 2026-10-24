<?php

namespace App\Http\Resources;

use App\Models\PrintJob;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * POST /api/v1/print-agent/jobs/{ulid}/result (Web POS & Print Bridge → E): the job's
 * `{ ulid, status }` after the result (`printed`, `queued` for a retry, or `failed`).
 *
 * @mixin PrintJob
 */
class PrintJobResultResource extends JsonResource
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
            'status' => $job->status,
        ];
    }
}
