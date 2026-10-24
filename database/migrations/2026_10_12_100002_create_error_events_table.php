<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Hardening & Pilot (Phase 8) → B: each occurrence of an error group. `ulid` is the
     * client's idempotency key (a duplicate is ignored). Events older than 90 days are pruned
     * daily (`error-log:prune`), then the groups left without events.
     */
    public function up(): void
    {
        Schema::create('error_events', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->unique();
            $table->foreignId('error_group_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('device_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamp('occurred_at');
            $table->timestamp('received_at');
            $table->string('message', 1000);
            $table->mediumText('stack')->nullable();
            $table->json('context')->nullable();

            $table->index(['error_group_id', 'occurred_at']);
            $table->index(['branch_id', 'error_group_id']);
            $table->index('received_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('error_events');
    }
};
