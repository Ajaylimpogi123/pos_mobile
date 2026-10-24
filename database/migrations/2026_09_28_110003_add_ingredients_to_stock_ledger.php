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
     * Ingredients, Recipes & Purchasing → B, K: the stock ledger generalises from products to
     * products **or** ingredients.
     *
     * - `stock_levels` and `stock_movements` gain a nullable `ingredient_id` beside a now-nullable
     *   `product_id`; exactly one of them is set (a CHECK constraint, and the actions).
     * - `stock_levels` gains UNIQUE `(branch_id, ingredient_id)` and `avg_cost` (centavos per
     *   base unit, a rate: DECIMAL(20,6); 0 for products, which keep using their `cost_cents`).
     * - Quantities become DECIMAL(15,3) (`qty`, `qty_delta`, and `reorder_level`, which was an
     *   unsigned int). Product stock stays whole units; the API still sends it as integers.
     * - `stock_movements` gains the entered quantity and unit (`entered_qty`, `entered_unit`) and
     *   `value_cents` (the signed value moved, ingredients only).
     * - Indexes for the ingredient history and the ingredient inventory report, mirroring the
     *   product ones.
     *
     * The product-based Inventory endpoints are unchanged.
     */
    public function up(): void
    {
        Schema::table('stock_levels', function (Blueprint $table) {
            $table->unsignedBigInteger('product_id')->nullable()->change();
            $table->foreignId('ingredient_id')->nullable()->after('product_id')->constrained()->restrictOnDelete();
            $table->decimal('qty', 15, 3)->default(0)->change();
            $table->decimal('reorder_level', 15, 3)->nullable()->change();
            $table->decimal('avg_cost', 20, 6)->default(0)->after('reorder_level');

            $table->unique(['branch_id', 'ingredient_id']);
        });

        Schema::table('stock_movements', function (Blueprint $table) {
            $table->unsignedBigInteger('product_id')->nullable()->change();
            $table->foreignId('ingredient_id')->nullable()->after('product_id')->constrained()->restrictOnDelete();
            $table->decimal('qty_delta', 15, 3)->change();
            $table->decimal('entered_qty', 15, 3)->nullable()->after('qty_delta');
            $table->string('entered_unit', 20)->nullable()->after('entered_qty');
            $table->bigInteger('value_cents')->nullable()->after('unit_cost_cents');

            $table->index(['branch_id', 'ingredient_id', 'occurred_at']);
            $table->index(
                ['branch_id', 'ingredient_id', 'type', 'occurred_at', 'qty_delta', 'value_cents'],
                'stock_movements_ingredient_report_index',
            );
        });

        foreach (['stock_levels', 'stock_movements'] as $table) {
            DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable($table)." ADD CONSTRAINT {$table}_one_item_check CHECK ((product_id IS NULL) <> (ingredient_id IS NULL))");
        }
    }

    /**
     * Reverse the migrations. Fails while ingredient rows exist, which is intended: the ledger
     * is never rewritten.
     */
    public function down(): void
    {
        foreach (['stock_movements', 'stock_levels'] as $table) {
            DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable($table)." DROP CHECK {$table}_one_item_check");
        }

        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropIndex('stock_movements_ingredient_report_index');
            $table->dropIndex(['branch_id', 'ingredient_id', 'occurred_at']);
            $table->dropConstrainedForeignId('ingredient_id');
            $table->dropColumn(['entered_qty', 'entered_unit', 'value_cents']);
            $table->decimal('qty_delta', 12, 4)->change();
            $table->unsignedBigInteger('product_id')->nullable(false)->change();
        });

        Schema::table('stock_levels', function (Blueprint $table) {
            $table->dropUnique(['branch_id', 'ingredient_id']);
            $table->dropConstrainedForeignId('ingredient_id');
            $table->dropColumn('avg_cost');
            $table->unsignedInteger('reorder_level')->nullable()->change();
            $table->decimal('qty', 12, 4)->default(0)->change();
            $table->unsignedBigInteger('product_id')->nullable(false)->change();
        });
    }
};
