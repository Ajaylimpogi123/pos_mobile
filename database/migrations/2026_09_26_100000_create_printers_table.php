<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Network thermal printers of a branch (Phase 4). Branch-scoped master data,
     * soft-deleted. The name is unique per branch among non-deleted printers, which is
     * enforced in validation (a DB unique index would also block reusing the name of a
     * deleted printer). There is no `connection` column: the only transport in v1 is raw
     * TCP (PROJECT_MEMORY §9); Bluetooth is deferred.
     */
    public function up(): void
    {
        Schema::create('printers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('name', 40);
            $table->string('role', 20);
            $table->string('host', 253);
            $table->unsignedInteger('port')->default(9100);
            $table->unsignedTinyInteger('paper_width_mm')->default(80);
            $table->boolean('is_enabled')->default(true);
            $table->boolean('is_default_kitchen')->default(false);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

            $table->index(['branch_id', 'name']);
            $table->index('updated_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('printers');
    }
};
