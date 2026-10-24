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
     * Ingredients, Recipes & Purchasing → J, K (Round B):
     *
     * - `recipe_lines`: a `recipe` product's components per **1 serving**: an ingredient **or** an
     *   `own`-stock product (`component_product_id`), exactly one (a CHECK), each at most once per
     *   recipe (the two UNIQUE keys). The entered `qty` + `unit` and `base_qty` (base units).
     * - `order_item_components`: the depletion snapshot of each sold recipe line: the component,
     *   `base_qty` for the whole line (component base_qty × line qty), `cost_cents` (its value at
     *   the time of sale) and `wasted_base_qty` (the refunded share, cumulative).
     * - `refund_item_components`: each refund's share of a snapshot (the wasted quantity), so the
     *   ingredient report and history show it as wasted on the refund's date. No stock moves.
     *
     * Every foreign key is RESTRICT (stock and order records). Quantities are DECIMAL(15,3).
     */
    public function up(): void
    {
        Schema::create('recipe_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->foreignId('ingredient_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('component_product_id')->nullable()->constrained('products')->restrictOnDelete();
            $table->decimal('qty', 15, 3);
            $table->string('unit', 20);
            $table->decimal('base_qty', 15, 3);
            $table->timestamps();

            $table->unique(['product_id', 'ingredient_id']);
            $table->unique(['product_id', 'component_product_id']);
        });

        Schema::create('order_item_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->foreignId('order_item_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('ingredient_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('base_qty', 15, 3);
            $table->bigInteger('cost_cents');
            $table->decimal('wasted_base_qty', 15, 3)->default(0);
            $table->timestamps();
        });

        Schema::create('refund_item_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('refund_id')->constrained()->restrictOnDelete();
            $table->foreignId('refund_item_id')->constrained()->restrictOnDelete();
            $table->foreignId('order_item_component_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('ingredient_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->restrictOnDelete();
            $table->decimal('base_qty', 15, 3);
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['branch_id', 'ingredient_id', 'occurred_at']);
        });

        foreach (['recipe_lines' => 'component_product_id', 'order_item_components' => 'product_id', 'refund_item_components' => 'product_id'] as $table => $product) {
            DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable($table)
                ." ADD CONSTRAINT {$table}_one_component_check CHECK ((ingredient_id IS NULL) <> ({$product} IS NULL))");
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('refund_item_components');
        Schema::dropIfExists('order_item_components');
        Schema::dropIfExists('recipe_lines');
    }
};
