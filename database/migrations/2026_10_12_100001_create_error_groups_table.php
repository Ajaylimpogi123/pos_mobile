<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Hardening & Pilot (Phase 8) → B: one row per distinct error (app or server), keyed by
     * its fingerprint. A new occurrence of a resolved group reopens it.
     */
    public function up(): void
    {
        Schema::create('error_groups', function (Blueprint $table) {
            $table->id();
            $table->char('fingerprint', 40)->unique();
            $table->string('source', 10);
            $table->string('level', 10);
            $table->string('message', 1000);
            $table->timestamp('first_seen_at');
            $table->timestamp('last_seen_at');
            $table->unsignedInteger('occurrences')->default(0);
            $table->string('status', 10)->default('open');
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->json('app_versions')->nullable();
            $table->timestamps();

            $table->index(['status', 'last_seen_at']);
            $table->index('last_seen_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('error_groups');
    }
};
