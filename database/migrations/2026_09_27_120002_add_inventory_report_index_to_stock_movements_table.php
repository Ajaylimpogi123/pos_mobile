<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Inventory (v1 completion): the covering index of the inventory report
     * (App\Actions\Reports\BuildInventoryReportAction), the "covering variant" the contract
     * allows. The report sums the branch's ledger per product and type (before the period,
     * and up to its end), so with `(branch_id, product_id, type)` first MySQL streams the
     * GROUP BY in index order without a temporary table, and `occurred_at, qty_delta` let it
     * answer from the index alone. Measured on a year of movements (performance test), this
     * is about a third faster than `(branch_id, occurred_at, product_id, type)`, whose range
     * scan needs a temporary table to group.
     */
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->index(['branch_id', 'product_id', 'type', 'occurred_at', 'qty_delta'], 'stock_movements_inventory_report_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropIndex('stock_movements_inventory_report_index');
        });
    }
};
