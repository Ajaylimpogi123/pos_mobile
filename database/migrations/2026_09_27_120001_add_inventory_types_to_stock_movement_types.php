<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Inventory (v1 completion): `stock_movements.type` gains `receipt` (stock in, positive,
     * with its unit cost), `count` (a stock count; the server works out the delta) and
     * `wastage` (spoilage, negative).
     */
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->enum('type', ['sale', 'adjustment', 'opening', 'void', 'refund', 'receipt', 'count', 'wastage'])->change();
        });
    }

    /**
     * Reverse the migrations. Fails while `receipt`, `count` or `wastage` movements exist,
     * which is intended: the ledger is never rewritten.
     */
    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->enum('type', ['sale', 'adjustment', 'opening', 'void', 'refund'])->change();
        });
    }
};
