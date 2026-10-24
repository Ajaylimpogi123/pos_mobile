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
     * The purchasing report (Ingredients, Recipes & Purchasing → I) reads every PR item of the
     * period with its PO line, in the order PR creation, PR, item. Measured on a year of data
     * (performance test, MySQL 8.4 with the default buffer pool), walking PRs → items → lines
     * through the foreign-key indexes, then sorting, was most of its cost. The items now carry what
     * the report scans on, all written once when the item or the PO is created and never changed:
     *
     * - `branch_id` and `requested_at`: the PR's branch and `created_at` (both immutable);
     * - `purchase_order_line_id`: the item's PO line, written in the transaction that creates the PO
     *   (DecidePurchaseRequestAction; a PO line belongs to exactly one PR item, and lines are never
     *   added or removed), so the line is read by its primary key.
     *
     * `purchase_request_items_report_index` is in the report's order (`requested_at`,
     * `purchase_request_id`, `id`), so the rows are read in order and stop after 501 matches, and the
     * totals group per PR as the index streams; the other columns make the item side index-only.
     * Existing rows are backfilled.
     */
    public function up(): void
    {
        Schema::table('purchase_request_items', function (Blueprint $table) {
            $table->foreignId('branch_id')->nullable()->after('purchase_request_id')->constrained()->restrictOnDelete();
            $table->timestamp('requested_at')->nullable()->after('branch_id');
            $table->foreignId('purchase_order_line_id')->nullable()->after('decided_at')
                ->constrained('purchase_order_lines')->restrictOnDelete();
        });

        // Through the builder, so the tables and aliases get the connection's table prefix.
        $column = fn (string $column) => DB::raw(DB::getQueryGrammar()->wrap($column));

        DB::table('purchase_request_items as pri')
            ->join('purchase_requests as pr', 'pr.id', '=', 'pri.purchase_request_id')
            ->update(['pri.branch_id' => $column('pr.branch_id'), 'pri.requested_at' => $column('pr.created_at')]);
        DB::table('purchase_request_items as pri')
            ->join('purchase_order_lines as pol', 'pol.purchase_request_item_id', '=', 'pri.id')
            ->update(['pri.purchase_order_line_id' => $column('pol.id')]);

        Schema::table('purchase_request_items', function (Blueprint $table) {
            $table->index(
                ['branch_id', 'requested_at', 'purchase_request_id', 'id', 'decision', 'supplier_id', 'ingredient_id', 'product_id', 'purchase_order_line_id'],
                'purchase_request_items_report_index',
            );
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('purchase_request_items', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropForeign(['purchase_order_line_id']);
        });

        Schema::table('purchase_request_items', function (Blueprint $table) {
            $table->dropIndex('purchase_request_items_report_index');
            $table->dropColumn(['branch_id', 'requested_at', 'purchase_order_line_id']);
        });
    }
};
