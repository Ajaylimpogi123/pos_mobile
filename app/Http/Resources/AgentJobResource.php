<?php

namespace App\Http\Resources;

use App\Models\PrintJob;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `AgentJob` (Web POS & Print Bridge → E): a claimed job as the print agent
 * needs it, `{ ulid, printer: { host, port }, payload_base64, attempts }`. The printer's
 * host and port are the ones read at claim time (load `printer`).
 *
 * @mixin PrintJob
 */
class AgentJobResource extends JsonResource
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
            'printer' => [
                'host' => $job->printer->host,
                'port' => (int) $job->printer->port,
            ],
            'payload_base64' => base64_encode($job->payload),
            'attempts' => $job->attempts,
        ];
    }
}
