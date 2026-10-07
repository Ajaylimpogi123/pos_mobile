<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Voids & Refunds (Phase 7): `stock_movements.type` gains `void` (a voided sale's stock
     * comes back, referencing the order) and `refund` (a refund's stock comes back,
     * referencing the refund). Both are positive reversing movements (PROJECT_MEMORY §4.5).
     */
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->enum('type', ['sale', 'adjustment', 'opening', 'void', 'refund'])->change();
        });
    }

    /**
     * Reverse the migrations. Fails while `void` or `refund` movements exist, which is
     * intended: the ledger is never rewritten.
     */
    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->enum('type', ['sale', 'adjustment', 'opening'])->change();
        });
    }
};
