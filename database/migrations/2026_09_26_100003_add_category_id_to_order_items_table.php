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
     * Order revision (Phase 4): `order_items.category_id`, the product's category at the
     * time of sale, so kitchen routing and reprints still use the right station after a
     * product is moved or deleted. Added nullable, backfilled from each line's product
     * (the best information available for lines sold before this column existed), then
     * made NOT NULL with a RESTRICT foreign key (categories are only ever soft-deleted).
     */
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->unsignedBigInteger('category_id')->nullable()->after('product_id');
        });

        DB::table('order_items')
            ->join('products', 'products.id', '=', 'order_items.product_id')
            ->whereNull('order_items.category_id')
            ->update(['order_items.category_id' => DB::raw('products.category_id')]);

        Schema::table('order_items', function (Blueprint $table) {
            $table->unsignedBigInteger('category_id')->nullable(false)->change();
            $table->foreign('category_id')->references('id')->on('categories')->restrictOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropForeign(['category_id']);
            $table->dropColumn('category_id');
        });
    }
};
