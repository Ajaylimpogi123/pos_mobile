<?php

namespace App\Actions\Printing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Printer;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

/**
 * Creates a printer in the caller's branch and writes a `printer.created` audit entry
 * (the fields plus `category_ids`, as changes from `null`).
 *
 * - The branch may have at most 20 non-deleted printers (409).
 * - `is_default_kitchen: true` clears the flag on every other printer of the branch.
 * - When the branch has no default kitchen printer, an **enabled** kitchen or bar printer
 *   becomes the default automatically, even when the request sends
 *   `is_default_kitchen: false` (Q-005).
 * - `category_ids` become this printer's routes; a category routed to another printer
 *   moves here. Every other printer changed this way gets its own `printer.updated`.
 *
 * Cashier printers never take routes or the default flag (StorePrinterRequest rejects
 * both with a 422 before this runs).
 */
class CreatePrinterAction
{
    public const MESSAGE_LIMIT = 'A branch can have up to 20 printers.';

    public const AUDITED_FIELDS = ['name', 'role', 'host', 'port', 'paper_width_mm', 'is_enabled', 'is_default_kitchen'];

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly BranchPrinterChanges $branchPrinters,
        private readonly SyncPrinterRoutesAction $syncRoutes,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     *
     * @throws ConflictException 409 when the branch already has 20 printers
     */
    public function execute(array $attributes, User $actor, ?string $ip = null): Printer
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): Printer {
            $branchId = $actor->branch_id;

            $this->branchPrinters->lockBranch($branchId);

            if (Printer::query()->where('branch_id', $branchId)->count() >= Printer::MAX_PER_BRANCH) {
                throw new ConflictException(self::MESSAGE_LIMIT);
            }

            $categoryIds = array_values($attributes['category_ids'] ?? []);

            $printer = new Printer;
            $printer->fill(Arr::except($attributes, ['category_ids']));

            if (! $printer->printsTickets()) {
                $printer->is_default_kitchen = false;
                $categoryIds = [];
            } elseif (! $printer->is_default_kitchen && $printer->is_enabled && ! $this->branchPrinters->hasDefaultKitchen($branchId)) {
                $printer->is_default_kitchen = true;
            }

            $before = $this->branchPrinters->snapshot($branchId);

            $printer->forceFill([
                'branch_id' => $branchId,
                'created_by' => $actor->id,
                'updated_by' => $actor->id,
            ])->save();

            if ($printer->is_default_kitchen) {
                $this->branchPrinters->clearOtherDefaults($printer);
            }

            $this->syncRoutes->execute($printer, $categoryIds);

            $this->recordAuditLog->execute(
                action: 'printer.created',
                actor: $actor,
                subject: $printer,
                changes: [
                    ...ModelChanges::created($printer, self::AUDITED_FIELDS),
                    'category_ids' => ['from' => null, 'to' => $printer->routedCategoryIds()],
                ],
                ip: $ip,
            );

            $this->branchPrinters->recordSideEffects($before, $branchId, $printer->id, $actor, $ip);

            return $printer->load('categories');
        });
    }
}
