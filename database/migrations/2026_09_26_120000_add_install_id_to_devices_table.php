<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Offline Sales (Phase 5): the app's per-install id (a ULID generated once and kept in
     * SecureStore), sent to POST /api/v1/devices/register. UNIQUE across all branches, so
     * one install is one device. Nullable for devices that existed before this phase.
     */
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->char('install_id', 26)->charset('ascii')->collation('ascii_bin')->nullable()->unique()->after('code');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropUnique(['install_id']);
            $table->dropColumn('install_id');
        });
    }
};
