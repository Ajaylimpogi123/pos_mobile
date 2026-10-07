<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Global master data (not branch-scoped). Soft-deleted. Money is integer centavos.
     * The SKU is unique among non-deleted rows, which is enforced in validation.
     */
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->string('sku', 50)->nullable();
            $table->string('name', 120);
            $table->string('description', 500)->nullable();
            $table->unsignedBigInteger('price_cents');
            $table->unsignedBigInteger('cost_cents')->default(0);
            $table->boolean('is_vatable')->default(true);
            $table->boolean('is_available')->default(true);
            $table->boolean('track_stock')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->string('image_path')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

            $table->index(['category_id', 'is_available']);
            $table->index('name');
            $table->index('sku');
            $table->index('updated_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
