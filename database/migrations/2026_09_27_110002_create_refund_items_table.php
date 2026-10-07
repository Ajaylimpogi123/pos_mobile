<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * The lines of a refund (Phase 7), in the order sent: which order line, how many units
     * and the amount (cumulative rounding, see App\Support\Sales\RefundCalculator). Never
     * deleted; every foreign key RESTRICT.
     *
     * The report columns copy facts fixed when the refund is recorded, as the Phase 6 report
     * tables do, so the product and category rows read this table alone through
     * `refund_items_sales_report_index`: `branch_id` and `business_date` (the **refund's**
     * business day), and the line's `product_id` and `category_id` snapshot.
     */
    public function up(): void
    {
        Schema::create('refund_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('refund_id')->constrained()->restrictOnDelete();
            $table->foreignId('order_item_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->date('business_date');
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->decimal('qty', 12, 4);
            $table->unsignedBigInteger('amount_cents');
            $table->timestamps();

            $table->index(
                ['branch_id', 'business_date', 'product_id', 'category_id', 'order_item_id', 'qty', 'amount_cents'],
                'refund_items_sales_report_index',
            );
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('refund_items');
    }
};
