<?php

namespace App\Actions\Purchasing;

use App\Actions\Sales\AllocateSequenceValue;
use App\Models\Branch;
use App\Support\BusinessDay;

/**
 * The numbers of purchase requests and orders (Ingredients, Recipes & Purchasing → F, G, K):
 * `PR-{branch.code}-{YYYY}-{00001}` / `PO-{branch.code}-{YYYY}-{00001}`, per branch and year, from
 * the row-locked `sequences` table (the names `purchase_request` / `purchase_order`, the period
 * is the year). The year is that of the current business date in the branch's timezone. Must run
 * inside the caller's transaction (a rolled-back write gives its number back).
 */
class AllocatePurchaseNumber
{
    public function __construct(private readonly AllocateSequenceValue $allocate) {}

    public function purchaseRequest(int $branchId): string
    {
        return $this->next($branchId, AllocateSequenceValue::PURCHASE_REQUEST, 'PR');
    }

    public function purchaseOrder(int $branchId): string
    {
        return $this->next($branchId, AllocateSequenceValue::PURCHASE_ORDER, 'PO');
    }

    private function next(int $branchId, string $name, string $prefix): string
    {
        $branch = Branch::withTrashed()->findOrFail($branchId);
        $year = substr(BusinessDay::forBranch($branch)->dateOf(now()), 0, 4);

        return sprintf('%s-%s-%s-%05d', $prefix, $branch->code, $year, $this->allocate->execute($branchId, $name, $year));
    }
}
