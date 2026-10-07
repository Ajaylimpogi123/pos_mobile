<?php

namespace App\Actions\Printing;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Printer;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

/**
 * Applies a partial update to a printer. Only the fields actually changed are written
 * to the `printer.updated` audit entry (`{ field: { from, to } }`), including
 * `category_ids` when the routes change. A request that changes nothing writes nothing
 * and leaves `updated_at` alone; a change to the routes alone still touches `updated_at`.
 *
 * - `category_ids` (when sent) replaces the routes; a category routed to another printer
 *   moves here.
 * - `is_default_kitchen: true` clears the flag on every other printer of the branch.
 * - Changing the role to `cashier` clears the routes and the default flag.
 * - A printer that becomes an enabled kitchen or bar printer (`is_enabled` false → true, or
 *   its role changed from `cashier`) while the branch has no default kitchen printer becomes
 *   the default, even when the request sends `is_default_kitchen: false` (Q-005). Nothing
 *   reassigns the default when the default printer is disabled, deleted or made a cashier.
 *
 * Every other printer changed as a side effect gets its own `printer.updated` entry.
 */
class UpdatePrinterAction
{
    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly BranchPrinterChanges $branchPrinters,
        private readonly SyncPrinterRoutesAction $syncRoutes,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     */
    public function execute(Printer $printer, array $attributes, User $actor, ?string $ip = null): Printer
    {
        return DB::transaction(function () use ($printer, $attributes, $actor, $ip): Printer {
            $branchId = $printer->branch_id;

            $this->branchPrinters->lockBranch($branchId);
            $printer->refresh();

            $categoryIds = array_key_exists('category_ids', $attributes) ? array_values($attributes['category_ids']) : null;
            $fromCategoryIds = $printer->routedCategoryIds();
            $before = $this->branchPrinters->snapshot($branchId, $printer->id);

            $printer->fill(Arr::except($attributes, ['category_ids']));

            if (! $printer->printsTickets()) {
                $printer->is_default_kitchen = false;
                $categoryIds = [];
            } elseif (
                ! $printer->is_default_kitchen
                && $printer->is_enabled
                && ($printer->getOriginal('is_enabled') === false || $printer->getOriginal('role') === Printer::ROLE_CASHIER)
                && ! $this->branchPrinters->hasDefaultKitchen($branchId, $printer->id)
            ) {
                $printer->is_default_kitchen = true;
            }

            $changes = ModelChanges::diff($printer);

            if ($printer->is_default_kitchen) {
                $this->branchPrinters->clearOtherDefaults($printer);
            }

            if ($categoryIds !== null) {
                $this->syncRoutes->execute($printer, $categoryIds);
            }

            $toCategoryIds = $printer->routedCategoryIds();

            if ($toCategoryIds !== $fromCategoryIds) {
                $changes['category_ids'] = ['from' => $fromCategoryIds, 'to' => $toCategoryIds];
            }

            if ($changes !== []) {
                $printer->forceFill(['updated_by' => $actor->id, 'updated_at' => $printer->freshTimestamp()])->save();

                $this->recordAuditLog->execute(
                    action: 'printer.updated',
                    actor: $actor,
                    subject: $printer,
                    changes: $changes,
                    ip: $ip,
                );
            }

            $this->branchPrinters->recordSideEffects($before, $branchId, $printer->id, $actor, $ip);

            return $printer->load('categories');
        });
    }
}
