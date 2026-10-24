<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Dine-in Tables & Tabs → B/H: the branch's tables. Branch-scoped master data,
     * soft-deleted. The name is unique per branch among non-deleted tables, which is enforced
     * in validation (a DB unique index would also block reusing the name of a deleted table).
     *
     * `area_sort` (generated, `COALESCE(area, '')`) is the non-null sort key of the cursor
     * lists (ordered by area, sort_order, name): a cursor can't continue after a NULL value
     * (the customers' `last_name_sort` does the same).
     */
    public function up(): void
    {
        Schema::create('dining_tables', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('name', 10);
            $table->string('area', 30)->nullable();
            $table->string('area_sort', 30)->storedAs("COALESCE(`area`, '')");
            $table->unsignedTinyInteger('seats');
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

            $table->index(['branch_id', 'area_sort', 'sort_order', 'name', 'id'], 'dining_tables_branch_order_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('dining_tables');
    }
};
