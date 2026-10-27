<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Table Management → E/G (TM2): reservations that hold a table. Never deleted: a
     * reservation ends `seated` (linked to the tab it opened), `cancelled` or `no_show`.
     *
     * - `business_date` is the branch business day of `reserved_for`, fixed when it is saved.
     * - Every foreign key is RESTRICT: a seated reservation reaches a tab, and tabs reach orders.
     * - `(branch_id, business_date, reserved_for, id)` serves the day list (cursor by
     *   `reserved_for`, then `id`) and the board's counts; `(table_id, status, reserved_for)`
     *   serves the clash and hold checks.
     */
    public function up(): void
    {
        Schema::create('table_reservations', function (Blueprint $table) {
            $table->id();
            $table->char('ulid', 26)->charset('ascii')->collation('ascii_bin')->unique();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('table_id')->constrained('dining_tables')->restrictOnDelete();
            $table->string('guest_name', 60);
            $table->string('phone', 20)->nullable();
            $table->unsignedTinyInteger('party_size');
            $table->timestamp('reserved_for');
            $table->date('business_date');
            $table->string('notes', 255)->nullable();
            $table->string('status', 20)->default('booked');
            $table->foreignId('tab_id')->nullable()->constrained('tabs')->restrictOnDelete();
            $table->string('cancel_reason', 255)->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('status_changed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('status_changed_at')->nullable();
            $table->timestamps();

            $table->index(['branch_id', 'business_date', 'reserved_for', 'id'], 'table_reservations_branch_day_index');
            $table->index(['table_id', 'status', 'reserved_for'], 'table_reservations_table_status_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('table_reservations');
    }
};
