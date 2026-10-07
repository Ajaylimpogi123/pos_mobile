<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The product and category rows of the sales report (App\Actions\Reports\BuildSalesReportAction)
     * group a year of order lines (~90,000 in the performance test). Grouping the range by
     * `product_id` from `order_items_sales_report_index` (business_date first) needed a sort of
     * every line. The report now groups per `(business_date, product_id | category_id)` as these
     * indexes stream (no sort; an order's lines share its business date, so the per-day distinct
     * order counts add up exactly), reading only the columns it sums. Measured on MySQL 8.4 with the
     * default buffer pool (performance test), this roughly halves the rows statement.
     */
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->index(
                ['branch_id', 'business_date', 'product_id', 'order_id', 'qty', 'gross_cents', 'line_total_cents'],
                'order_items_product_report_index',
            );
            $table->index(
                ['branch_id', 'business_date', 'category_id', 'order_id', 'qty', 'gross_cents', 'line_total_cents'],
                'order_items_category_report_index',
            );
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropIndex('order_items_product_report_index');
            $table->dropIndex('order_items_category_report_index');
        });
    }
};
