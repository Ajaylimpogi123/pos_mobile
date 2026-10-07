<?php

namespace App\Actions\Sales;

use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Hands out the next number of a per-branch sequence from the row-locked `sequences`
 * table (never `COUNT(*)`, PROJECT_MEMORY §4.4). Numbers start at 1.
 *
 * One upsert creates the row or increments it, and takes an exclusive lock on the row
 * either way; the lock is held until the caller's transaction ends, so concurrent sales
 * are serialised and a rolled-back sale gives its number back. Must run inside the
 * caller's transaction.
 */
class AllocateSequenceValue
{
    /**
     * `INV-{branch}-{8 digits}`, per branch, never reset.
     */
    public const INVOICE = 'invoice';

    /**
     * Per branch and business day (the period is the business date).
     */
    public const QUEUE = 'queue';

    /**
     * `PR-{branch}-{YYYY}-{5 digits}`, per branch and year (the period is the year).
     */
    public const PURCHASE_REQUEST = 'purchase_request';

    /**
     * `PO-{branch}-{YYYY}-{5 digits}`, per branch and year (the period is the year).
     */
    public const PURCHASE_ORDER = 'purchase_order';

    public function execute(int $branchId, string $name, string $period = ''): int
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Sequence numbers must be allocated inside a transaction.');
        }

        $now = now();

        DB::table('sequences')->upsert(
            [[
                'branch_id' => $branchId,
                'name' => $name,
                'period' => $period,
                'next_value' => 2,
                'created_at' => $now,
                'updated_at' => $now,
            ]],
            ['branch_id', 'name', 'period'],
            ['next_value' => DB::raw('next_value + 1'), 'updated_at' => $now],
        );

        $next = DB::table('sequences')
            ->where('branch_id', $branchId)
            ->where('name', $name)
            ->where('period', $period)
            ->lockForUpdate()
            ->value('next_value');

        return (int) $next - 1;
    }
}
