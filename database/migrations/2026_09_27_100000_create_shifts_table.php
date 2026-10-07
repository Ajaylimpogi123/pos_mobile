<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Expression;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Cash shifts (Phase 6): one open shift per tablet at a time. Opened, and closed, on the
     * tablet (possibly offline) with a ULID made there, then synced. Shifts are financial
     * records: never deleted, every foreign key RESTRICT.
     *
     * - `status` is not stored: a shift is open while `closed_at` is null.
     * - `closed_by`, `counted_cash_cents` and `close_note` stay null for a shift that was
     *   auto-closed by the next shift of its tablet (`flags` then holds `auto_closed`).
     * - `flags`: a JSON list (`auto_closed`, `movement_after_close`), `[]` when none.
     * - `synced_at`: when the server first received the shift.
     * - The report (X-read / Z-read) is computed live from the orders and cash movements
     *   that carry the shift's ULID; nothing of it is stored here.
     *
     * INDEX (device_id, closed_at) finds a tablet's open shift; (branch_id, opened_at) serves
     * the shifts list.
     */
    public function up(): void
    {
        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_id')->constrained()->restrictOnDelete();
            $table->timestamp('opened_at');
            $table->foreignId('opened_by')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('opening_float_cents');
            $table->timestamp('closed_at')->nullable();
            $table->foreignId('closed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('counted_cash_cents')->nullable();
            $table->string('close_note', 255)->nullable();
            $table->json('flags')->default(new Expression('(JSON_ARRAY())'));
            $table->timestamp('synced_at');
            $table->timestamps();

            $table->index(['branch_id', 'opened_at']);
            $table->index(['device_id', 'closed_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('shifts');
    }
};
