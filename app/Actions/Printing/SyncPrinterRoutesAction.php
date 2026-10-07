<?php

namespace App\Actions\Printing;

use App\Models\Printer;
use App\Models\PrintRoute;

/**
 * Replaces a printer's category routes (`category_ids` on the admin printer endpoints).
 *
 * - Every listed category ends up routed to this printer. A category routed to another
 *   printer of the branch **moves** here (UNIQUE branch_id, category_id: one upsert).
 * - Every other route of this printer is removed. An empty list clears its routes.
 *
 * Runs inside the caller's transaction, after the branch row is locked
 * (BranchPrinterChanges::lockBranch). Auditing and `updated_at` are the caller's job:
 * compare Printer::routedCategoryIds() before and after, and use BranchPrinterChanges
 * for the printers that lost a category.
 */
class SyncPrinterRoutesAction
{
    /**
     * @param  list<int>  $categoryIds  Validated, non-deleted category ids
     */
    public function execute(Printer $printer, array $categoryIds): void
    {
        $categoryIds = array_values(array_unique(array_map('intval', $categoryIds)));
        sort($categoryIds);

        PrintRoute::query()
            ->where('printer_id', $printer->id)
            ->when($categoryIds !== [], fn ($query) => $query->whereNotIn('category_id', $categoryIds))
            ->delete();

        if ($categoryIds === []) {
            return;
        }

        $now = now();

        PrintRoute::query()->upsert(
            array_map(fn (int $categoryId) => [
                'branch_id' => $printer->branch_id,
                'category_id' => $categoryId,
                'printer_id' => $printer->id,
                'created_at' => $now,
                'updated_at' => $now,
            ], $categoryIds),
            ['branch_id', 'category_id'],
            ['printer_id', 'updated_at'],
        );
    }
}
