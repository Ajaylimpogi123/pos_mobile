<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * One row per `Idempotency-Key` (a client ULID, unique across endpoints). A row is
     * `processing` while its first request runs and `completed` once that request
     * succeeded (2xx), holding the stored status and body for replays. A failed request
     * deletes its row, so the key is not used up.
     *
     * `request_hash` is the SHA-256 of the canonical body without `pin` (the body itself
     * is never stored). `response_body` is text, not JSON: MySQL's JSON type would reorder
     * keys, and a replay must return the stored body as it was sent. `branch_id` keeps
     * replays within the branch that made the request.
     */
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->id();
            $table->char('key', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('endpoint');
            $table->char('request_hash', 64)->charset('ascii')->collation('ascii_bin');
            $table->string('status', 20);
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->mediumText('response_body')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('idempotency_keys');
    }
};
