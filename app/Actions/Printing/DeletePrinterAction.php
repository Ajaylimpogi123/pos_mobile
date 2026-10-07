<?php

namespace App\Actions\Printing;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Printer;
use App\Models\PrintRoute;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deletes a printer: removes its routes (their categories fall back to the default
 * kitchen printer), clears its default flag, and writes a `printer.deleted` audit entry.
 * No other printer becomes the default automatically.
 */
class DeletePrinterAction
{
    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly BranchPrinterChanges $branchPrinters,
    ) {}

    public function execute(Printer $printer, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($printer, $actor, $ip): void {
            $this->branchPrinters->lockBranch($printer->branch_id);

            PrintRoute::query()->where('printer_id', $printer->id)->delete();

            $printer->forceFill(['is_default_kitchen' => false, 'updated_by' => $actor->id])->save();
            $printer->delete();

            $this->recordAuditLog->execute(
                action: 'printer.deleted',
                actor: $actor,
                subject: $printer,
                changes: ['name' => $printer->name],
                ip: $ip,
            );
        });
    }
}
