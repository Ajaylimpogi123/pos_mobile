<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Dine-in Tables & Tabs → D/H: open bills at a table, the lines sent to the kitchen in
     * rounds, and the cancellations of sent lines.
     *
     * - `tabs.open_table_id` is UNIQUE and equals `table_id` while the tab is open (null
     *   otherwise), so one table never has two open tabs, even under concurrency.
     * - Tabs are linked from `orders.tab_id`, so every foreign key that reaches a tab, its
     *   lines or their cancellations is RESTRICT (never CASCADE into orders).
     * - `tab_items` hold the snapshots taken when the round was sent (the settlement price).
     */
    public function up(): void
    {
        Schema::create('tabs', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('table_id')->constrained('dining_tables')->restrictOnDelete();
            $table->unsignedBigInteger('open_table_id')->nullable()->unique();
            $table->string('status', 20)->default('open');
            $table->unsignedSmallInteger('guests');
            $table->foreignId('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('notes', 255)->nullable();
            $table->unsignedSmallInteger('rounds_count')->default(0);
            $table->foreignId('opened_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('opened_at');
            $table->foreignId('closed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('closed_at')->nullable();
            $table->foreignId('merged_into_tab_id')->nullable()->constrained('tabs')->restrictOnDelete();
            $table->foreignId('device_id')->nullable()->constrained()->restrictOnDelete();
            $table->timestamps();

            $table->index(['branch_id', 'status']);
        });

        Schema::create('tab_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tab_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('round_no');
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->string('product_name', 120);
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->string('category_name', 80);
            $table->string('sku', 50)->nullable();
            $table->unsignedBigInteger('unit_price_cents');
            $table->boolean('is_vatable');
            $table->unsignedInteger('qty');
            $table->unsignedInteger('settled_qty')->default(0);
            $table->unsignedInteger('cancelled_qty')->default(0);
            $table->string('notes', 120)->nullable();
            $table->foreignId('added_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('added_at');
            $table->timestamps();

            $table->index(['tab_id', 'round_no', 'id']);
            $table->index('product_id');
        });

        Schema::create('tab_item_cancellations', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('tab_item_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('qty');
            $table->string('reason', 255);
            $table->foreignId('cancelled_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('authorized_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('tab_item_cancellations');
        Schema::dropIfExists('tab_items');
        Schema::dropIfExists('tabs');
    }
};
