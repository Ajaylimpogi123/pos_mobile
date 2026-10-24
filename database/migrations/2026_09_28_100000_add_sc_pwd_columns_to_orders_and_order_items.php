<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The report indexes' columns before this migration (Phase 6).
     */
    private const ORDERS_REPORT_COLUMNS = ['branch_id', 'business_date', 'status', 'user_id', 'items_qty', 'subtotal_cents', 'discount_cents', 'total_cents', 'vat_amount_cents'];

    private const ORDER_ITEMS_REPORT_COLUMNS = ['branch_id', 'business_date', 'product_id', 'category_id', 'order_id', 'qty', 'gross_cents', 'line_discount_cents', 'order_discount_share_cents', 'line_total_cents'];

    /**
     * Run the migrations.
     *
     * Senior Citizen / PWD discount (SC/PWD contract, *Data model*):
     *
     * - `orders`: the request as sent (`sc_pwd_mode` `items` | `headcount`, null without
     *   SC/PWD; `sc_pwd_diners`, `headcount` only; `sc_pwd_vat_exempt`; `sc_pwd_persons`, the
     *   `[{type, id_no}]` list), plus `R` (`sc_pwd_vat_relief_cents`) and `S`
     *   (`sc_pwd_discount_cents`). Both are part of `discount_cents`.
     * - `order_items`: `is_sc_pwd` (marked, or given a share in `headcount` mode), `E_i`
     *   (`sc_pwd_eligible_cents`), `R_i` and `S_i`.
     *
     * Existing rows get the defaults (no SC/PWD). The sales report reads its figures
     * index-only (Phase 6 performance budget), so its covering indexes gain the new figures:
     * `orders_sales_report_index` the SC/PWD mode (the order count), `R` and `S`;
     * `order_items_sales_report_index` `R_i` and `S_i` (the product and category discounts).
     * Each index is rebuilt in one statement, so a foreign key relying on it is never left
     * without an index.
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('sc_pwd_mode', 10)->nullable()->after('order_discount_cents');
            $table->unsignedSmallInteger('sc_pwd_diners')->nullable()->after('sc_pwd_mode');
            $table->boolean('sc_pwd_vat_exempt')->default(false)->after('sc_pwd_diners');
            $table->json('sc_pwd_persons')->nullable()->after('sc_pwd_vat_exempt');
            $table->unsignedBigInteger('sc_pwd_vat_relief_cents')->default(0)->after('sc_pwd_persons');
            $table->unsignedBigInteger('sc_pwd_discount_cents')->default(0)->after('sc_pwd_vat_relief_cents');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->boolean('is_sc_pwd')->default(false)->after('line_total_cents');
            $table->unsignedBigInteger('sc_pwd_eligible_cents')->default(0)->after('is_sc_pwd');
            $table->unsignedBigInteger('sc_pwd_vat_relief_cents')->default(0)->after('sc_pwd_eligible_cents');
            $table->unsignedBigInteger('sc_pwd_discount_cents')->default(0)->after('sc_pwd_vat_relief_cents');
        });

        $this->rebuildIndex('orders', 'orders_sales_report_index', [
            ...self::ORDERS_REPORT_COLUMNS, 'sc_pwd_mode', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents',
        ]);

        $this->rebuildIndex('order_items', 'order_items_sales_report_index', [
            ...self::ORDER_ITEMS_REPORT_COLUMNS, 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents',
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        $this->rebuildIndex('order_items', 'order_items_sales_report_index', self::ORDER_ITEMS_REPORT_COLUMNS);
        $this->rebuildIndex('orders', 'orders_sales_report_index', self::ORDERS_REPORT_COLUMNS);

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn(['is_sc_pwd', 'sc_pwd_eligible_cents', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'sc_pwd_mode', 'sc_pwd_diners', 'sc_pwd_vat_exempt', 'sc_pwd_persons',
                'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents',
            ]);
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
