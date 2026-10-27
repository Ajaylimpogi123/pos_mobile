<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Table Management → B/G: a table's place on its area's floor plan (a 24 × 16 cell grid).
     * `pos_x` and `pos_y` are both null while the table isn't placed (every existing table
     * starts unplaced); `width` and `height` are 1–6 cells; `shape` is `rect` or `round`.
     * Only the layout endpoint writes them.
     */
    public function up(): void
    {
        Schema::table('dining_tables', function (Blueprint $table) {
            $table->unsignedTinyInteger('pos_x')->nullable()->after('seats');
            $table->unsignedTinyInteger('pos_y')->nullable()->after('pos_x');
            $table->unsignedTinyInteger('width')->default(2)->after('pos_y');
            $table->unsignedTinyInteger('height')->default(2)->after('width');
            $table->string('shape', 10)->default('rect')->after('height');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('dining_tables', function (Blueprint $table) {
            $table->dropColumn(['pos_x', 'pos_y', 'width', 'height', 'shape']);
        });
    }
};
