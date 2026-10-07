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
     * Ingredients, Recipes & Purchasing → J, K (Round B): products get a stock mode, `own` (sold
     * as-is from its own stock), `recipe` (made to order: a sale depletes its components) or
     * `none`. The existing flag maps `track_stock = true` → `own`, everything else → `none`.
     *
     * `track_stock` stays, as a STORED generated column `stock_mode = 'own'`: every response,
     * query and index that keyed off it keeps working unchanged, and it can never disagree with
     * `stock_mode` (it is read-only; the Product model maps a written `track_stock` onto
     * `stock_mode`).
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->enum('stock_mode', ['own', 'recipe', 'none'])->default('none')->after('is_available');
        });

        DB::table('products')->where('track_stock', true)->update(['stock_mode' => 'own']);

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('track_stock');
        });

        Schema::table('products', function (Blueprint $table) {
            $table->boolean('track_stock')->storedAs("(`stock_mode` = 'own')")->after('stock_mode');
        });
    }

    /**
     * Reverse the migrations: `track_stock` becomes a plain column again (`own` → true).
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('track_stock');
        });

        Schema::table('products', function (Blueprint $table) {
            $table->boolean('track_stock')->default(false)->after('is_available');
        });

        DB::table('products')->where('stock_mode', 'own')->update(['track_stock' => true]);

        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('stock_mode');
        });
    }
};
