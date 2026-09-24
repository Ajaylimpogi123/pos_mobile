<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('branch_id')->after('id')->constrained()->restrictOnDelete();
            $table->foreignId('role_id')->after('branch_id')->constrained()->restrictOnDelete();
            $table->string('pin_hash')->nullable()->after('password');
            $table->boolean('is_active')->default(true)->after('pin_hash');
            $table->timestamp('last_login_at')->nullable()->after('is_active');
            $table->foreignId('created_by')->nullable()->after('remember_token')->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->after('created_by')->constrained('users')->nullOnDelete();
            $table->softDeletes();

            $table->index(['branch_id', 'name']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
            $table->dropForeign(['role_id']);
            $table->dropForeign(['created_by']);
            $table->dropForeign(['updated_by']);
            $table->dropIndex(['branch_id', 'name']);
            $table->dropColumn([
                'branch_id', 'role_id', 'pin_hash', 'is_active', 'last_login_at',
                'created_by', 'updated_by', 'deleted_at',
            ]);
        });
    }
};
