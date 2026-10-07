<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * An order's payments (split tender), in the order sent. `amount_cents` is what the
     * payment contributes to the total, so Σ amount_cents = the order's total_cents:
     * cash stores `tendered_cents` (handed over), `change_cents` and tendered − change;
     * GCash stores the amount paid, `tendered_cents = null`, `change_cents = 0` and its
     * `reference_no`.
     */
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->string('method', 20);
            $table->unsignedBigInteger('amount_cents');
            $table->unsignedBigInteger('tendered_cents')->nullable();
            $table->unsignedBigInteger('change_cents')->default(0);
            $table->string('reference_no', 64)->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
