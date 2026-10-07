<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Ingredients, Recipes & Purchasing → D1 (Set cost): `stock_movements.type` gains
     * `revaluation`, an ingredient's manual cost (`qty_delta` 0; `value_cents` is the change in
     * the stock value).
     */
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->enum('type', ['sale', 'adjustment', 'opening', 'void', 'refund', 'receipt', 'count', 'wastage', 'revaluation'])->change();
        });
    }

    /**
     * Reverse the migrations. Fails while `revaluation` movements exist, which is intended: the
     * ledger is never rewritten.
     */
    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->enum('type', ['sale', 'adjustment', 'opening', 'void', 'refund', 'receipt', 'count', 'wastage'])->change();
        });
    }
};
