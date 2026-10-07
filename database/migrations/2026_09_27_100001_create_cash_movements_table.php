<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Cash put into (`in`) or taken out of (`out`) a shift's drawer (Phase 6), recorded on
     * the tablet with its own ULID and synced. `amount_cents` is always positive; the type
     * gives the direction. Financial records: never deleted, every foreign key RESTRICT.
     *
     * `shift_ulid` references `shifts.ulid` (the endpoint only accepts a movement for a
     * shift the server already knows, so the key always resolves).
     */
    public function up(): void
    {
        Schema::create('cash_movements', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->char('shift_ulid', 26)->charset('ascii')->collation('ascii_bin');
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->string('type', 3);
            $table->unsignedBigInteger('amount_cents');
            $table->string('reason', 120);
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->foreign('shift_ulid')->references('ulid')->on('shifts')->restrictOnDelete();
            $table->index(['shift_ulid', 'type']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('cash_movements');
    }
};
