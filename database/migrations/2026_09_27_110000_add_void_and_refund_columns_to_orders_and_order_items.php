<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Voids & Refunds (Phase 7). Orders are never deleted: a void or a refund is a state
     * change (`orders.status`: `voided`, `refunded`, `partially_refunded`) plus its own
     * records.
     *
     * - `orders.voided_at`, `voided_by` (the user who made the void request),
     *   `void_reason` and `void_authorized_by` (the approver when a manager PIN was used).
     *   Both user columns are RESTRICT and nullable.
     * - `orders.refunded_cents`: Σ of the order's refunds (`refunds.amount_cents`).
     * - `order_items.refunded_qty` / `refunded_cents`: what each line has had refunded, so a
     *   partial refund always knows the remaining quantity and the cumulative rounding.
     *
     * The voids of the sales figures read `orders_sales_report_index` (it already carries
     * `status` and `total_cents`) and, per shift, INDEX (shift_ulid, status).
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->timestamp('voided_at')->nullable()->after('synced_at');
            $table->foreignId('voided_by')->nullable()->after('voided_at')->constrained('users')->restrictOnDelete();
            $table->string('void_reason', 255)->nullable()->after('voided_by');
            $table->foreignId('void_authorized_by')->nullable()->after('void_reason')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('refunded_cents')->default(0)->after('total_cents');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('refunded_qty', 12, 4)->default(0)->after('line_total_cents');
            $table->unsignedBigInteger('refunded_cents')->default(0)->after('refunded_qty');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn(['refunded_qty', 'refunded_cents']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['voided_by']);
            $table->dropForeign(['void_authorized_by']);
            $table->dropColumn(['voided_at', 'voided_by', 'void_reason', 'void_authorized_by', 'refunded_cents']);
        });
    }
};
