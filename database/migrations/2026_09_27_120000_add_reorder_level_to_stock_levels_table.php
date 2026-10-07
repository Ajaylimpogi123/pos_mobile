<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Inventory (v1 completion): the per-branch reorder level of a product, chosen by a
     * manager. `null` means no low-stock alert. The stock status (`in_stock`, `low`, `out`)
     * is derived from `qty` and this level, never stored (PROJECT_MEMORY §4.5).
     */
    public function up(): void
    {
        Schema::table('stock_levels', function (Blueprint $table) {
            $table->unsignedInteger('reorder_level')->nullable()->after('qty');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('stock_levels', function (Blueprint $table) {
            $table->dropColumn('reorder_level');
        });
    }
};
