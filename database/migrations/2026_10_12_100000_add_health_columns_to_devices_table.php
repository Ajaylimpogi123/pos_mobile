<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Hardening & Pilot (Phase 8) → C: a device can be retired (`is_active = false` plus
     * `retired_at`) and restored, and it reports its health in a heartbeat: the last body
     * (`last_heartbeat`, JSON), when it arrived (`last_heartbeat_at`) and who was signed in
     * (`last_user_id`).
     */
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->timestamp('retired_at')->nullable()->after('is_active');
            $table->json('last_heartbeat')->nullable()->after('retired_at');
            $table->timestamp('last_heartbeat_at')->nullable()->after('last_heartbeat');
            $table->foreignId('last_user_id')->nullable()->after('last_heartbeat_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('last_user_id');
            $table->dropColumn(['retired_at', 'last_heartbeat', 'last_heartbeat_at']);
        });
    }
};
