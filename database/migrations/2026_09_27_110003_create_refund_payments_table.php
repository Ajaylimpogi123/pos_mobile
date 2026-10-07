<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * How a refund's money went back (Phase 7), cash first: cash from the refunding tablet's
     * drawer, GCash sent back from the store's account with its `reference_no`. A separate
     * table, not negative `payments` rows (a deliberate change from PROJECT_MEMORY §5), so the
     * Phase 6 payment sums stay untouched. Never deleted; every foreign key RESTRICT.
     *
     * `branch_id` / `business_date` (the refund's business day) let the payment rows of the
     * sales report read this table alone through `refund_payments_sales_report_index`.
     */
    public function up(): void
    {
        Schema::create('refund_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('refund_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->date('business_date');
            $table->string('method', 20);
            $table->unsignedBigInteger('amount_cents');
            $table->string('reference_no', 64)->nullable();
            $table->timestamps();

            $table->index(['branch_id', 'business_date', 'method', 'amount_cents'], 'refund_payments_sales_report_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('refund_payments');
    }
};
