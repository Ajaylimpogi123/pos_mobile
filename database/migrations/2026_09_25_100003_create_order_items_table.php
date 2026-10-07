<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Order lines, with snapshots of the product (`product_name`, `category_name`, `sku`,
     * `unit_price_cents`, `unit_cost_cents`, `is_vatable`) taken at sale time, so later
     * menu edits never rewrite history. `product_id` is RESTRICT: the product row is kept
     * even when it is soft-deleted. The line discount is stored as sent (`discount_type`
     * is `none` without one). `unit_cost_cents` is never returned by the API.
     */
    public function up(): void
    {
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->string('product_name', 120);
            $table->string('category_name', 80);
            $table->string('sku', 50)->nullable();
            $table->unsignedBigInteger('unit_price_cents');
            $table->unsignedBigInteger('unit_cost_cents');
            $table->boolean('is_vatable');
            $table->decimal('qty', 12, 4);
            $table->unsignedBigInteger('gross_cents');
            $table->string('discount_type', 20)->default('none');
            $table->string('discount_kind', 10)->nullable();
            $table->unsignedBigInteger('discount_value')->nullable();
            $table->unsignedBigInteger('line_discount_cents');
            $table->unsignedBigInteger('order_discount_share_cents');
            $table->unsignedBigInteger('line_total_cents');
            $table->string('notes', 120)->nullable();
            $table->timestamps();

            $table->index(['product_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('order_items');
    }
};
