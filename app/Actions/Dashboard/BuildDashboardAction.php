<?php

namespace App\Actions\Dashboard;

use App\Actions\Inventory\IngredientInventoryQuery;
use App\Actions\Inventory\InventoryQuery;
use App\Models\Branch;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequest;
use App\Models\User;
use App\Support\BusinessDay;
use Carbon\CarbonImmutable;

/**
 * Builds the data behind GET /api/v1/dashboard for the caller.
 *
 * Each section is gated by permission; a section the caller may not see is `null`:
 * - `catalog`, `activity`: `report.view`
 * - `staff`: `user.manage`
 * - `customers`: any authenticated user
 * - `sales`: `report.view` (Phase 3: today's sales of the branch; Phase 7: not voided, plus voids and refunds)
 * `insights` are derived only from the visible sections; the stock alerts (Inventory) need
 * `inventory.adjust` or `report.view` and count the caller's branch.
 *
 * Staff, activity and sales are scoped to the caller's branch; catalogue and customers
 * are global.
 * Every section uses aggregate SQL, so the number of queries does not grow with the data.
 */
class BuildDashboardAction
{
    public function __construct(
        private readonly BuildCatalogSection $catalog,
        private readonly BuildStaffSection $staff,
        private readonly BuildCustomersSection $customers,
        private readonly BuildActivitySection $activity,
        private readonly BuildSalesSection $sales,
        private readonly BuildInsights $insights,
        private readonly InventoryQuery $inventory,
        private readonly IngredientInventoryQuery $ingredients,
    ) {}

    /**
     * @return array{
     *     generated_at: CarbonImmutable,
     *     business_date: string,
     *     catalog: array<string, mixed>|null,
     *     staff: array<string, mixed>|null,
     *     customers: array<string, int>,
     *     activity: array<string, mixed>|null,
     *     sales: array<string, mixed>|null,
     *     insights: list<array<string, mixed>>,
     * }
     */
    public function execute(User $caller, ?CarbonImmutable $now = null): array
    {
        $now = ($now ?? now()->toImmutable())->utc();
        $branchId = (int) $caller->branch_id;
        $businessDay = BusinessDay::forBranch(Branch::withTrashed()->find($branchId));

        $canViewReports = $caller->hasPermission('report.view');

        $catalog = $canViewReports ? $this->catalog->execute() : null;
        $staff = $caller->hasPermission('user.manage') ? $this->staff->execute($branchId) : null;
        $customers = $this->customers->execute($now);
        $activity = $canViewReports ? $this->activity->execute($branchId, $businessDay, $now) : null;
        $sales = $canViewReports ? $this->sales->execute($branchId, $businessDay, $now) : null;

        $canViewInventory = $caller->hasPermission('inventory.adjust') || $canViewReports;

        $insights = $this->insights->execute(
            $catalog,
            $staff,
            $sales !== null ? $this->sales->countNeedingReview($branchId) : null,
            $canViewInventory ? $this->inventory->summary($branchId) : null,
            $canViewInventory ? $this->ingredients->summary($branchId) : null,
            $this->purchasingQueues($caller, $branchId),
        );

        // Internal to the insights; not a contract field.
        if ($catalog !== null) {
            unset($catalog['low_margin_count']);
        }

        return [
            'generated_at' => $now,
            'business_date' => $businessDay->dateOf($now),
            'catalog' => $catalog,
            'staff' => $staff,
            'customers' => $customers,
            'activity' => $activity,
            'sales' => $sales,
            'insights' => $insights,
        ];
    }

    /**
     * The branch's purchasing queues the caller acts on (Ingredients, Recipes & Purchasing):
     * with `purchase.approve` the PRs and POs pending approval, with `purchase.receive` the
     * approved POs not fully received.
     *
     * @return array{requests_pending?: int, orders_pending?: int, orders_to_receive?: int}
     */
    private function purchasingQueues(User $caller, int $branchId): array
    {
        $queues = [];

        if ($caller->hasPermission('purchase.approve')) {
            $queues['requests_pending'] = PurchaseRequest::query()
                ->where('branch_id', $branchId)
                ->where('status', PurchaseRequest::STATUS_PENDING)
                ->count();
            $queues['orders_pending'] = PurchaseOrder::query()
                ->where('branch_id', $branchId)
                ->where('status', PurchaseOrder::STATUS_PENDING)
                ->count();
        }

        if ($caller->hasPermission('purchase.receive')) {
            $queues['orders_to_receive'] = PurchaseOrder::query()
                ->where('branch_id', $branchId)
                ->where('status', PurchaseOrder::STATUS_APPROVED)
                ->where('receiving_status', '!=', PurchaseOrder::RECEIVING_FULL)
                ->count();
        }

        return $queues;
    }
}
