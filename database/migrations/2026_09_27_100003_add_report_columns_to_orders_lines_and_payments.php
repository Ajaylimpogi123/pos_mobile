<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Sales reports (Phase 6) must answer over a full year in under 500 ms. Joining a year of
     * orders to their lines and payments row by row costs seconds, so the facts a report
     * filters and sums on are copied where it reads them, and each report query becomes an
     * index-only range scan:
     *
     * - `orders.items_qty`: Σ qty of the order's lines (fixed at sale time), so order-level
     *   figures (`items_sold`, day and cashier rows, the shift report) never read the lines.
     * - `order_items.branch_id` / `business_date` and `payments.branch_id` / `business_date`:
     *   the order's branch and business day (both fixed at sale time), so product, category
     *   and payment rows read only their own table. The order's `status` stays on `orders`
     *   only; reports exclude orders that aren't `completed` through a small anti-join.
     * - Covering indexes for the report queries on all three tables.
     *
     * Every column is written by App\Actions\Sales\RecordOrder in the sale's transaction.
     * Existing rows are backfilled from their order.
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('items_qty', 12, 4)->default(0)->after('queue_no');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_id')->nullable()->after('order_id');
            $table->date('business_date')->nullable()->after('branch_id');
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_id')->nullable()->after('order_id');
            $table->date('business_date')->nullable()->after('branch_id');
        });

        // Raw SQL is never prefixed: tables and qualified columns go through the grammar.
        $grammar = DB::getQueryGrammar();

        DB::table('orders')->update([
            'items_qty' => DB::raw("(SELECT COALESCE(SUM({$grammar->wrap('order_items.qty')}), 0) FROM {$grammar->wrapTable('order_items')}"
                ." WHERE {$grammar->wrap('order_items.order_id')} = {$grammar->wrap('orders.id')})"),
        ]);

        foreach (['order_items', 'payments'] as $table) {
            DB::table($table)
                ->join('orders', 'orders.id', '=', "{$table}.order_id")
                ->update([
                    "{$table}.branch_id" => DB::raw($grammar->wrap('orders.branch_id')),
                    "{$table}.business_date" => DB::raw($grammar->wrap('orders.business_date')),
                ]);

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->unsignedBigInteger('branch_id')->nullable(false)->change();
                $blueprint->date('business_date')->nullable(false)->change();
                $blueprint->foreign('branch_id')->references('id')->on('branches')->restrictOnDelete();
            });
        }

        Schema::table('orders', function (Blueprint $table) {
            $table->index(
                ['branch_id', 'business_date', 'status', 'user_id', 'items_qty', 'subtotal_cents', 'discount_cents', 'total_cents', 'vat_amount_cents'],
                'orders_sales_report_index',
            );
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->index(
                ['branch_id', 'business_date', 'product_id', 'category_id', 'order_id', 'qty', 'gross_cents', 'line_discount_cents', 'order_discount_share_cents', 'line_total_cents'],
                'order_items_sales_report_index',
            );
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->index(['branch_id', 'business_date', 'method', 'order_id', 'amount_cents'], 'payments_sales_report_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropIndex('payments_sales_report_index');
            $table->dropColumn(['branch_id', 'business_date']);
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropIndex('order_items_sales_report_index');
            $table->dropColumn(['branch_id', 'business_date']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_sales_report_index');
            $table->dropColumn('items_qty');
        });
    }
};
