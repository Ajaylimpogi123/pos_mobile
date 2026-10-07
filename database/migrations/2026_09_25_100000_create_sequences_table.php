<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Row-locked number allocation, never `COUNT(*)` (PROJECT_MEMORY §4.4). One row per
     * branch, sequence name and period: `invoice` has no period (never reset), `queue`
     * uses the business date (reset every business day). `next_value` is the next number
     * to hand out. See App\Actions\Sales\AllocateSequenceValue.
     */
    public function up(): void
    {
        Schema::create('sequences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('name', 40);
            $table->string('period', 20)->default('');
            $table->unsignedBigInteger('next_value');
            $table->timestamps();

            $table->unique(['branch_id', 'name', 'period']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('sequences');
    }
};
