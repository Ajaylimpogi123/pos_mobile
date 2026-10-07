<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The cached quantity on hand per branch and product (PROJECT_MEMORY §4.5). It is only
     * ever written in the same transaction as a `stock_movements` row (the ledger is the
     * truth), under `lockForUpdate`. A missing row means 0. Whole units in Phase 3; the
     * API sends `qty` as an integer.
     */
    public function up(): void
    {
        Schema::create('stock_levels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->decimal('qty', 12, 4)->default(0);
            $table->timestamps();

            $table->unique(['branch_id', 'product_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('stock_levels');
    }
};
