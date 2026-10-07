<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Shifts & Reporting (Phase 6): `orders.shift_ulid`, the shift the sale was rung up in.
     * Nullable (orders placed before Phase 6 have none) and indexed, with **no foreign key**:
     * an offline sale may reach the server before its shift's open event. Reports link
     * orders to shifts by this ULID.
     *
     * INDEX (shift_ulid, status) serves the shift report (PROJECT_MEMORY §5.4 `(shift_id)`).
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->char('shift_ulid', 26)->charset('ascii')->collation('ascii_bin')->nullable()->after('device_id');

            $table->index(['shift_ulid', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['shift_ulid', 'status']);
            $table->dropColumn('shift_ulid');
        });
    }
};
