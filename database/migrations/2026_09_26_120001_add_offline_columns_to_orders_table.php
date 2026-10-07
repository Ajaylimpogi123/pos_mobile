<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Expression;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Offline Sales (Phase 5):
     * - `device_id` (RESTRICT, nullable): the tablet that recorded the sale (the token's
     *   device), and `order_no`: the device number of an offline sale
     *   (`T01-20260926-0005`), null for online sales. UNIQUE (device_id, order_no),
     *   PROJECT_MEMORY §4.4 / §5.4.
     * - `source` (`online` | `offline`), `needs_review` and `review_reasons` (a JSON list
     *   of the review flags), `reviewed_at` / `reviewed_by` (RESTRICT), `synced_at`.
     * - INDEX (branch_id, needs_review) for the Needs review list and the dashboard insight.
     *
     * Existing rows (all online sales) get `source = online`, `needs_review = false` and
     * `review_reasons = []`.
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('device_id')->nullable()->after('branch_id')->constrained()->restrictOnDelete();
            $table->string('order_no', 40)->nullable()->after('invoice_no');
            $table->string('source', 10)->default('online')->after('status');
            $table->boolean('needs_review')->default(false)->after('has_total_mismatch');
            $table->json('review_reasons')->default(new Expression('(JSON_ARRAY())'))->after('needs_review');
            $table->timestamp('reviewed_at')->nullable()->after('review_reasons');
            $table->foreignId('reviewed_by')->nullable()->after('reviewed_at')->constrained('users')->restrictOnDelete();
            $table->timestamp('synced_at')->nullable()->after('placed_at');

            $table->unique(['device_id', 'order_no']);
            $table->index(['branch_id', 'needs_review']);
        });

        // The column defaults already fill existing rows; this makes the backfill explicit.
        DB::table('orders')->update([
            'source' => 'online',
            'needs_review' => false,
            'review_reasons' => DB::raw('JSON_ARRAY()'),
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            // The foreign keys go first, so no index they rely on is dropped under them.
            $table->dropForeign(['device_id']);
            $table->dropForeign(['reviewed_by']);
            $table->dropIndex(['branch_id', 'needs_review']);
            $table->dropUnique(['device_id', 'order_no']);
            $table->dropColumn([
                'device_id', 'order_no', 'source', 'needs_review', 'review_reasons', 'reviewed_at', 'reviewed_by', 'synced_at',
            ]);
        });
    }
};
