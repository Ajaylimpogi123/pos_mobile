<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Web POS & Print Bridge → D: the server-side print queue of the web terminals. Each job
     * holds the raw ESC/POS bytes the browser built (`payload`, MEDIUMBLOB) for one printer;
     * the print agent claims queued jobs and sends them over TCP (→ E).
     *
     * - `ulid`: client-generated, the idempotency key.
     * - INDEX (branch_id, status, id) serves the agent's claim (oldest queued first).
     * - INDEX (branch_id, order_ulid) serves the first-print deduplication lookup.
     * - Pruned 30 days after printing or failing (`print-jobs:prune`), so not financial:
     *   the device FK is nulled when a device row is removed; printer, branch and user RESTRICT.
     */
    public function up(): void
    {
        Schema::create('print_jobs', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('device_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('printer_id')->constrained()->restrictOnDelete();
            $table->enum('kind', ['receipt', 'kitchen', 'x_read', 'z_read', 'void_slip', 'kitchen_void', 'refund_slip', 'test']);
            $table->char('order_ulid', 26)->charset('ascii')->collation('ascii_bin')->nullable();
            $table->unsignedTinyInteger('copy_no')->default(1);
            $table->boolean('is_reprint')->default(false);
            $table->binary('payload');
            $table->enum('status', ['queued', 'printing', 'printed', 'failed'])->default('queued');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->string('last_error', 255)->nullable();
            $table->string('claimed_by', 40)->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('printed_at')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->index(['branch_id', 'status', 'id']);
            $table->index(['branch_id', 'order_ulid']);
        });

        // Up to 16 MB per row (a BLOB stops at 64 KB, the payload limit itself).
        DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable('print_jobs').' MODIFY payload MEDIUMBLOB NOT NULL');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('print_jobs');
    }
};
