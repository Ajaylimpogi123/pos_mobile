<?php

namespace App\Actions\Printing;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Branch;
use App\Models\Printer;
use App\Models\User;

/**
 * Shared by the printer actions, inside their transaction:
 *
 * - lockBranch(): every printer write locks the branch row FOR UPDATE first, so writes
 *   to one branch's printers (the 20-printer cap, the default kitchen printer, route
 *   moves) are serialised.
 * - snapshot() / recordSideEffects(): a write to one printer can change others (their
 *   default flag is cleared, or a category moves away from them). The other printers'
 *   `is_default_kitchen` and `category_ids` are captured before the write and compared
 *   after it; each printer that changed gets its `updated_at` / `updated_by` touched and
 *   its own `printer.updated` audit entry with the `{from, to}` changes. A branch has at
 *   most 20 printers, so this is cheap.
 */
class BranchPrinterChanges
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function lockBranch(int $branchId): void
    {
        Branch::query()->whereKey($branchId)->lockForUpdate()->first();
    }

    /**
     * Whether a non-deleted printer of the branch (other than the given one) is the
     * default kitchen printer.
     */
    public function hasDefaultKitchen(int $branchId, ?int $exceptPrinterId = null): bool
    {
        return Printer::query()
            ->where('branch_id', $branchId)
            ->where('is_default_kitchen', true)
            ->when($exceptPrinterId !== null, fn ($query) => $query->whereKeyNot($exceptPrinterId))
            ->exists();
    }

    /**
     * Clears the default flag on every other non-deleted printer of the branch.
     */
    public function clearOtherDefaults(Printer $printer): void
    {
        Printer::query()
            ->where('branch_id', $printer->branch_id)
            ->whereKeyNot($printer->id)
            ->where('is_default_kitchen', true)
            ->update(['is_default_kitchen' => false]);
    }

    /**
     * The other non-deleted printers' default flag and visible routes, by printer id.
     *
     * @return array<int, array{is_default_kitchen: bool, category_ids: list<int>}>
     */
    public function snapshot(int $branchId, ?int $exceptPrinterId = null): array
    {
        return Printer::query()
            ->with(['categories' => fn ($query) => $query->select('categories.id')])
            ->where('branch_id', $branchId)
            ->when($exceptPrinterId !== null, fn ($query) => $query->whereKeyNot($exceptPrinterId))
            ->get()
            ->mapWithKeys(fn (Printer $printer) => [$printer->id => [
                'is_default_kitchen' => $printer->is_default_kitchen,
                'category_ids' => $printer->routedCategoryIds(),
            ]])
            ->all();
    }

    /**
     * Touches and audits (`printer.updated`) every printer in `$before` that changed.
     *
     * @param  array<int, array{is_default_kitchen: bool, category_ids: list<int>}>  $before
     */
    public function recordSideEffects(array $before, int $branchId, ?int $exceptPrinterId, User $actor, ?string $ip): void
    {
        if ($before === []) {
            return;
        }

        $after = $this->snapshot($branchId, $exceptPrinterId);

        foreach ($before as $printerId => $was) {
            $now = $after[$printerId] ?? null;

            if ($now === null) {
                continue;
            }

            $changes = [];

            foreach (['is_default_kitchen', 'category_ids'] as $field) {
                if ($was[$field] !== $now[$field]) {
                    $changes[$field] = ['from' => $was[$field], 'to' => $now[$field]];
                }
            }

            if ($changes === []) {
                continue;
            }

            $printer = Printer::query()->findOrFail($printerId);
            $printer->forceFill(['updated_by' => $actor->id, 'updated_at' => $printer->freshTimestamp()])->save();

            $this->recordAuditLog->execute(
                action: 'printer.updated',
                actor: $actor,
                subject: $printer,
                changes: $changes,
                ip: $ip,
            );
        }
    }
}
