<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Ingredients (Ingredients, Recipes & Purchasing → A, D): global master data, soft-deleted,
     * each with one base unit (`g`, `mL` or `pc`) in which its stock, cost and ledger are
     * kept. The name is unique among non-deleted rows (validation).
     *
     * `ingredient_units`: the ingredient's own units, 1 `name` = `factor` × the base unit
     * (e.g. Flour: `sack` = 25000). The name is unique per ingredient, case-insensitively (the
     * table's `_ci` collation). The set is replaced by the admin endpoints (rows are
     * configuration; history keeps the entered unit's name and factor on its own rows).
     */
    public function up(): void
    {
        Schema::create('ingredients', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->enum('base_unit', ['g', 'mL', 'pc']);
            $table->string('image_path')->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

            $table->index('name');
        });

        Schema::create('ingredient_units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ingredient_id')->constrained()->restrictOnDelete();
            $table->string('name', 20);
            $table->decimal('factor', 17, 10);
            $table->timestamps();

            $table->unique(['ingredient_id', 'name']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('ingredient_units');
        Schema::dropIfExists('ingredients');
    }
};
