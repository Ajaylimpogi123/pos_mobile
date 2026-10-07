<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Category → printer routing per branch (Phase 4). A category goes to at most one
     * printer in a branch (UNIQUE branch_id, category_id); categories with no route go to
     * the branch's default kitchen printer. Written only by
     * App\Actions\Printing\SyncPrinterRoutesAction and the printer actions.
     */
    public function up(): void
    {
        Schema::create('print_routes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->foreignId('printer_id')->constrained()->restrictOnDelete();
            $table->timestamps();

            $table->unique(['branch_id', 'category_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('print_routes');
    }
};
