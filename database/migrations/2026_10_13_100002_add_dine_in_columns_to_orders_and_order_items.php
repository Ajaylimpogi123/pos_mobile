<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * `orders_sales_report_index` before this migration (Phase 6 + SC/PWD).
     */
    private const ORDERS_REPORT_COLUMNS = [
        'branch_id', 'business_date', 'status', 'user_id', 'items_qty', 'subtotal_cents', 'discount_cents',
        'total_cents', 'vat_amount_cents', 'sc_pwd_mode', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents',
    ];

    /**
     * Run the migrations.
     *
     * Dine-in Tables & Tabs → H:
     *
     * - `orders`: `tab_id` (the tab this order settled; null for pay-now sales; RESTRICT),
     *   `service_charge_cents` (`S`, part of `total_cents`), `service_charge_waived` and
     *   `split_count` (the equal-split share count, null when not split).
     * - `order_items`: `tab_item_id` (the tab line it settled; RESTRICT).
     *
     * The sales report reads its order totals index-only, so `orders_sales_report_index`
     * gains `service_charge_cents` (rebuilt in one statement, as the SC/PWD migration does).
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('tab_id')->nullable()->after('table_no')->constrained('tabs')->restrictOnDelete();
            $table->unsignedBigInteger('service_charge_cents')->default(0)->after('tab_id');
            $table->boolean('service_charge_waived')->default(false)->after('service_charge_cents');
            $table->unsignedTinyInteger('split_count')->nullable()->after('service_charge_waived');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->foreignId('tab_item_id')->nullable()->after('order_id')->constrained('tab_items')->restrictOnDelete();
        });

        $this->rebuildIndex('orders', 'orders_sales_report_index', [...self::ORDERS_REPORT_COLUMNS, 'service_charge_cents']);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        $this->rebuildIndex('orders', 'orders_sales_report_index', self::ORDERS_REPORT_COLUMNS);

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('tab_item_id');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('tab_id');
            $table->dropColumn(['service_charge_cents', 'service_charge_waived', 'split_count']);
        });
    }

    /**
     * Drops and re-adds the index with the given columns in a single ALTER TABLE (MySQL).
     *
     * @param  list<string>  $columns
     */
    private function rebuildIndex(string $table, string $index, array $columns): void
    {
        $quoted = implode(', ', array_map(fn (string $column) => "`{$column}`", $columns));

        DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable($table)." DROP INDEX `{$index}`, ADD INDEX `{$index}` ({$quoted})");
    }
};
