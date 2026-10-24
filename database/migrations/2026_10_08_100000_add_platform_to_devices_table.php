<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Web POS & Print Bridge → C: a device is a tablet (`android`) or a browser terminal
     * (`web`). Existing devices are tablets. Set once, when the device is registered; it
     * never changes afterwards.
     */
    public function up(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->string('platform', 10)->default('android')->after('code');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropColumn('platform');
        });
    }
};
