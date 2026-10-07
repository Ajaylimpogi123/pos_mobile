<?php

namespace App\Actions\Printing;

use App\Models\Branch;
use App\Models\Printer;
use App\Models\User;
use App\Support\BranchSettings;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;

/**
 * Everything a device needs to print, for the caller's branch (GET /api/v1/print-config):
 * the branch, its settings with defaults, and every non-deleted printer (disabled ones
 * included; at most 20, so not paginated) ordered by name then id, with its routes to
 * non-deleted categories.
 */
class BuildPrintConfigAction
{
    /**
     * @return array{branch: Branch, settings: BranchSettings, printers: Collection<int, Printer>, generated_at: CarbonImmutable}
     */
    public function execute(User $caller): array
    {
        /** @var Branch $branch */
        $branch = $caller->branch()->firstOrFail();

        $printers = Printer::query()
            ->with('categories')
            ->where('branch_id', $branch->id)
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        return [
            'branch' => $branch,
            'settings' => BranchSettings::for($branch),
            'printers' => $printers,
            'generated_at' => CarbonImmutable::now(),
        ];
    }
}
