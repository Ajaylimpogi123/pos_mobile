<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Completed sales (Phase 3, online only). Orders are never deleted, and every foreign
     * key is RESTRICT. Money is integer centavos, all computed by the server
     * (App\Support\Sales\SaleCalculator); `client_total_cents` is the app's checksum.
     *
     * - `discount_type` is the order discount's type, or `none`; `discount_kind` and
     *   `discount_value` are as sent (null without an order discount), and
     *   `order_discount_cents` is the computed `D`.
     * - `discount_cents` = line discounts + `D`; `total_cents` = subtotal − discount.
     * - `tendered_cents` / `change_cents` summarise the payments.
     *
     * No `device_id`, `order_no` or `shift_id` yet: Phases 5 and 6 add them (with the
     * UNIQUE (device_id, order_no) and (shift_id) indexes of PROJECT_MEMORY §5.4).
     */
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('authorized_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('invoice_no', 40)->unique();
            $table->unsignedInteger('queue_no');
            $table->date('business_date');
            $table->string('status', 20)->default('completed');
            $table->unsignedBigInteger('subtotal_cents');
            $table->unsignedBigInteger('line_discounts_cents');
            $table->string('discount_type', 20)->default('none');
            $table->string('discount_kind', 10)->nullable();
            $table->unsignedBigInteger('discount_value')->nullable();
            $table->unsignedBigInteger('order_discount_cents');
            $table->unsignedBigInteger('discount_cents');
            $table->unsignedBigInteger('total_cents');
            $table->unsignedBigInteger('vatable_sales_cents');
            $table->unsignedBigInteger('vat_amount_cents');
            $table->unsignedBigInteger('vat_exempt_sales_cents');
            $table->unsignedBigInteger('tendered_cents');
            $table->unsignedBigInteger('change_cents');
            $table->unsignedBigInteger('client_total_cents');
            $table->boolean('has_total_mismatch')->default(false);
            $table->string('notes', 255)->nullable();
            $table->timestamp('placed_at');
            $table->timestamps();

            $table->index(['branch_id', 'placed_at']);
            $table->index(['branch_id', 'business_date']);
            $table->index(['user_id', 'placed_at']);
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
