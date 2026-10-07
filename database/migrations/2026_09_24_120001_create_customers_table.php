<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Global master data (not branch-scoped). Soft-deleted. `email` is not unique
     * (families share emails).
     *
     * `last_name_sort` is a generated, never-written copy of `last_name` with NULL
     * as ''. Lists order by (first_name, last_name, id) using it, because cursor
     * pagination cannot compare against a NULL cursor value.
     */
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('first_name', 60);
            $table->string('last_name', 60)->nullable();
            $table->string('last_name_sort', 60)->storedAs("COALESCE(`last_name`, '')");
            $table->string('contact', 30)->nullable();
            $table->string('email', 255)->nullable();
            $table->string('notes', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->softDeletes();
            $table->timestamps();

            $table->index('contact');
            $table->index('last_name');
            $table->index(['first_name', 'last_name_sort', 'id']);
            $table->index('updated_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('customers');
    }
};
