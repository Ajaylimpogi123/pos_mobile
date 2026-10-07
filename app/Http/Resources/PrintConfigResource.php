<?php

namespace App\Http\Resources;

use App\Models\Branch;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's GET /api/v1/print-config body (Phase 4). Wraps the array built by
 * App\Actions\Printing\BuildPrintConfigAction.
 *
 * @property array<string, mixed> $resource
 */
class PrintConfigResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Branch $branch */
        $branch = $this->resource['branch'];

        /** @var CarbonInterface $generatedAt */
        $generatedAt = $this->resource['generated_at'];

        return [
            'branch' => [
                'id' => $branch->id,
                'name' => $branch->name,
                'timezone' => $branch->timezone,
            ],
            'settings' => new BranchSettingsResource($this->resource['settings']),
            'printers' => PrinterResource::collection($this->resource['printers']),
            'generated_at' => $generatedAt->toIso8601ZuluString(),
        ];
    }
}
