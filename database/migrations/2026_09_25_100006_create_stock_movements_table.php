<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The append-only stock ledger (PROJECT_MEMORY §4.5). `type` is limited to the kinds
     * Phase 3 writes (`sale`, `adjustment`, `opening`); later phases extend the enum
     * (void, refund, receipt, ...). `reference` points at the source record (an order for
     * a sale). `unit_cost_cents` is the product's cost at the time.
     */
    public function up(): void
    {
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->enum('type', ['sale', 'adjustment', 'opening']);
            $table->decimal('qty_delta', 12, 4);
            $table->unsignedBigInteger('unit_cost_cents')->nullable();
            $table->nullableMorphs('reference');
            $table->string('reason', 255)->nullable();
            $table->timestamp('occurred_at');
            $table->foreignId('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->index(['branch_id', 'product_id', 'occurred_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
    }
};
