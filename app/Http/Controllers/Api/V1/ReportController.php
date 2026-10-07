<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Reports\BuildIngredientInventoryReportAction;
use App\Actions\Reports\BuildInventoryReportAction;
use App\Actions\Reports\BuildPurchasingReportAction;
use App\Actions\Reports\BuildSalesReportAction;
use App\Actions\Reports\InventoryReport;
use App\Actions\Reports\InventoryReportCsv;
use App\Actions\Reports\PurchasingReport;
use App\Actions\Reports\PurchasingReportCsv;
use App\Actions\Reports\SalesReport;
use App\Actions\Reports\SalesReportCsv;
use App\Http\Controllers\Controller;
use App\Http\Requests\Reports\InventoryReportRequest;
use App\Http\Requests\Reports\PurchasingReportRequest;
use App\Http\Requests\Reports\SalesReportRequest;
use App\Http\Resources\InventoryReportResource;
use App\Http\Resources\PurchasingReportResource;
use App\Http\Resources\SalesReportResource;
use App\Models\Order;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\User;
use Illuminate\Http\Response;

/**
 * Reports (permission `report.view`), for the caller's branch. The exports are the same
 * reports as CSV, the endpoints that don't return JSON (their errors still do).
 *
 * - Sales (Phase 6): sales (not voided) by business date, grouped by day, product, category,
 *   payment or cashier (BuildSalesReportAction).
 * - Inventory (v1 completion): each tracked product's stock flow over the period and its
 *   current stock (BuildInventoryReportAction); with `kind=ingredients` (Ingredients, Recipes &
 *   Purchasing) each ingredient's (BuildIngredientInventoryReportAction).
 * - Purchasing (Ingredients, Recipes & Purchasing; `report.view` or `purchase.approve`): one row
 *   per purchase request item with its PO line (BuildPurchasingReportAction).
 */
class ReportController extends Controller
{
    /**
     * GET /api/v1/reports/sales
     */
    public function sales(SalesReportRequest $request, BuildSalesReportAction $build): SalesReportResource
    {
        return new SalesReportResource($this->report($request, $build));
    }

    /**
     * GET /api/v1/reports/sales/export
     */
    public function export(SalesReportRequest $request, BuildSalesReportAction $build, SalesReportCsv $csv): Response
    {
        $report = $this->report($request, $build);

        return $this->csv($csv->build($report), SalesReportCsv::filename($report));
    }

    /**
     * GET /api/v1/reports/inventory
     */
    public function inventory(InventoryReportRequest $request, BuildInventoryReportAction $build, BuildIngredientInventoryReportAction $buildIngredients): InventoryReportResource
    {
        return new InventoryReportResource($this->inventoryReport($request, $build, $buildIngredients));
    }

    /**
     * GET /api/v1/reports/inventory/export
     */
    public function inventoryExport(InventoryReportRequest $request, BuildInventoryReportAction $build, BuildIngredientInventoryReportAction $buildIngredients, InventoryReportCsv $csv): Response
    {
        $report = $this->inventoryReport($request, $build, $buildIngredients);

        return $this->csv($csv->build($report), InventoryReportCsv::filename($report));
    }

    /**
     * GET /api/v1/reports/purchasing
     */
    public function purchasing(PurchasingReportRequest $request, BuildPurchasingReportAction $build): PurchasingReportResource
    {
        return new PurchasingReportResource($this->purchasingReport($request, $build));
    }

    /**
     * GET /api/v1/reports/purchasing/export
     */
    public function purchasingExport(PurchasingReportRequest $request, BuildPurchasingReportAction $build, PurchasingReportCsv $csv): Response
    {
        $report = $this->purchasingReport($request, $build);

        return $this->csv($csv->build($report), PurchasingReportCsv::filename($report));
    }

    private function purchasingReport(PurchasingReportRequest $request, BuildPurchasingReportAction $build): PurchasingReport
    {
        $this->authorize('viewReport', PurchaseOrder::class);

        /** @var User $caller */
        $caller = $request->user();

        return $build->execute((int) $caller->branch_id, $request->from(), $request->to(), $request->filters());
    }

    private function report(SalesReportRequest $request, BuildSalesReportAction $build): SalesReport
    {
        $this->authorize('viewSalesReports', Order::class);

        /** @var User $caller */
        $caller = $request->user();

        return $build->execute((int) $caller->branch_id, $request->from(), $request->to(), $request->groupBy());
    }

    private function inventoryReport(InventoryReportRequest $request, BuildInventoryReportAction $build, BuildIngredientInventoryReportAction $buildIngredients): InventoryReport
    {
        $this->authorize('viewInventoryReport', Product::class);

        /** @var User $caller */
        $caller = $request->user();

        if ($request->kind() === InventoryReport::KIND_INGREDIENTS) {
            return $buildIngredients->execute((int) $caller->branch_id, $request->from(), $request->to(), $request->status());
        }

        return $build->execute((int) $caller->branch_id, $request->from(), $request->to(), $request->categoryId(), $request->status());
    }

    private function csv(string $body, string $filename): Response
    {
        return response($body, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
        ]);
    }
}
