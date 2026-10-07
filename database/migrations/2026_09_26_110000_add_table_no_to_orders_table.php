<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Core Sale revision 2: an optional free-text table number typed by the cashier
     * (e.g. `12`, `A3`, `Patio 2`), printed on the kitchen ticket and the receipt.
     * Existing orders are null.
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('table_no', 10)->nullable()->after('queue_no');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('table_no');
        });
    }
};
