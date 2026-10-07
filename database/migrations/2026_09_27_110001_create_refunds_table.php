<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Refunds (Phase 7): one row per refund of an order, full or partial. A financial record:
     * never deleted, every foreign key RESTRICT.
     *
     * - `ulid` UNIQUE: made by the app when the refund screen opens (the idempotency key).
     * - `branch_id` / `business_date`: the refund's own business day (at `refunded_at`, the
     *   server time), not the sale's; refunds count on their own day in every sales figure.
     * - `shift_ulid`: the **refunding** tablet's shift (char 26, no foreign key, as on orders:
     *   the shift's open event may still be in the tablet's outbox). `device_id`: that tablet.
     * - `refunded_by`: the user who made the request; `authorized_by`: the approver when a
     *   manager PIN was used (null when the caller had `sale.refund`).
     * - `amount_cents` and its VAT split, rounded once per refund.
     *
     * Indexes: `refunds_sales_report_index` covers the report totals, the day rows and the
     * cashier rows (through `order_id`); (shift_ulid, branch_id, amount_cents) covers the
     * shift report.
     */
    public function up(): void
    {
        Schema::create('refunds', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->date('business_date');
            $table->char('shift_ulid', 26)->charset('ascii')->collation('ascii_bin');
            $table->foreignId('device_id')->constrained()->restrictOnDelete();
            $table->foreignId('refunded_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('authorized_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('reason', 255);
            $table->unsignedBigInteger('amount_cents');
            $table->unsignedBigInteger('vatable_sales_cents');
            $table->unsignedBigInteger('vat_amount_cents');
            $table->unsignedBigInteger('vat_exempt_sales_cents');
            $table->timestamp('refunded_at');
            $table->timestamps();

            $table->index(['branch_id', 'business_date', 'order_id', 'amount_cents'], 'refunds_sales_report_index');
            $table->index(['shift_ulid', 'branch_id', 'amount_cents']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('refunds');
    }
};
