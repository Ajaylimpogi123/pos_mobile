<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Purchasing (Ingredients, Recipes & Purchasing → F, G, H, K): purchase request (PR) →
     * purchase order (PO, one per PR) → goods receipts. Financial records: never deleted, every
     * foreign key RESTRICT, quantities DECIMAL(15,3), money integer centavos.
     *
     * - An item or line is an ingredient **or** a product (exactly one, a CHECK constraint).
     * - Every quantity keeps the entered `qty` + `unit`, the unit's `unit_factor` (a snapshot:
     *   base units per 1 `unit`, exact) and `base_qty`.
     * - `purchase_order_lines.received_base_qty` and `received_cents` are caches of the line's
     *   append-only `goods_receipt_lines`, written in the same transaction (as `stock_levels`
     *   caches the ledger); the receiving statuses are derived from them and stored for the
     *   filters and the report.
     * - `pr_no` / `po_no` come from the row-locked `sequences` table (per branch and year).
     */
    public function up(): void
    {
        Schema::create('purchase_requests', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('pr_no', 40)->unique();
            $table->foreignId('requested_by')->constrained('users')->restrictOnDelete();
            $table->enum('status', ['pending_approval', 'approved', 'partially_approved', 'declined', 'cancelled'])->default('pending_approval');
            $table->date('date_needed')->nullable();
            $table->string('remarks', 500)->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['branch_id', 'created_at']);
            $table->index(['branch_id', 'status']);
        });

        Schema::create('purchase_request_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_request_id')->constrained()->restrictOnDelete();
            $table->foreignId('ingredient_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->decimal('qty', 15, 3);
            $table->string('unit', 20);
            $table->decimal('unit_factor', 24, 12);
            $table->decimal('base_qty', 15, 3);
            $table->unsignedBigInteger('estimated_unit_price_cents')->nullable();
            $table->string('remarks', 255)->nullable();
            $table->enum('decision', ['pending', 'approved', 'declined'])->default('pending');
            $table->string('decision_reason', 255)->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();
        });

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('po_no', 40)->unique();
            $table->foreignId('purchase_request_id')->unique()->constrained()->restrictOnDelete();
            $table->enum('status', ['pending_approval', 'approved', 'declined'])->default('pending_approval');
            $table->enum('receiving_status', ['not_received', 'partially_received', 'fully_received'])->default('not_received');
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->foreignId('declined_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('declined_at')->nullable();
            $table->string('decline_reason', 255)->nullable();
            $table->date('expected_delivery_date')->nullable();
            $table->string('remarks', 500)->nullable();
            $table->unsignedBigInteger('total_cents')->default(0);
            $table->timestamps();

            $table->index(['branch_id', 'status', 'receiving_status']);
        });

        Schema::create('purchase_order_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_id')->constrained()->restrictOnDelete();
            $table->foreignId('purchase_request_item_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('ingredient_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->decimal('qty', 15, 3);
            $table->string('unit', 20);
            $table->decimal('unit_factor', 24, 12);
            $table->decimal('base_qty', 15, 3);
            $table->unsignedBigInteger('unit_price_cents')->default(0);
            $table->unsignedBigInteger('line_total_cents')->default(0);
            $table->decimal('received_base_qty', 15, 3)->default(0);
            $table->bigInteger('received_cents')->default(0);
            $table->enum('receiving_status', ['pending', 'partial', 'complete', 'over_received'])->default('pending');
            $table->timestamp('last_received_at')->nullable();
            $table->timestamps();
        });

        Schema::create('goods_receipts', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('purchase_order_id')->constrained()->restrictOnDelete();
            $table->foreignId('received_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('received_at');
            $table->string('remarks', 500)->nullable();
            $table->timestamps();
        });

        Schema::create('goods_receipt_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('goods_receipt_id')->constrained()->restrictOnDelete();
            $table->foreignId('purchase_order_line_id')->constrained()->restrictOnDelete();
            $table->decimal('qty', 15, 3);
            $table->string('unit', 20);
            $table->decimal('unit_factor', 24, 12);
            $table->decimal('base_qty', 15, 3);
            $table->bigInteger('cost_cents');
            $table->string('reason', 255)->nullable();
            $table->timestamps();
        });

        foreach (['purchase_request_items', 'purchase_order_lines'] as $table) {
            DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable($table)." ADD CONSTRAINT {$table}_one_item_check CHECK ((product_id IS NULL) <> (ingredient_id IS NULL))");
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('goods_receipt_lines');
        Schema::dropIfExists('goods_receipts');
        Schema::dropIfExists('purchase_order_lines');
        Schema::dropIfExists('purchase_orders');
        Schema::dropIfExists('purchase_request_items');
        Schema::dropIfExists('purchase_requests');
    }
};
