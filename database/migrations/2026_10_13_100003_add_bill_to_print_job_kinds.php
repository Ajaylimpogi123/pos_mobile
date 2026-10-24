<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const KINDS = ['receipt', 'kitchen', 'x_read', 'z_read', 'void_slip', 'kitchen_void', 'refund_slip', 'test'];

    /**
     * Run the migrations.
     *
     * Dine-in Tables & Tabs → F: the print-job `kind` gains `bill` (a tab's bill, sent to
     * the receipt printer by web terminals).
     */
    public function up(): void
    {
        $this->setKinds([...self::KINDS, 'bill']);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        $this->setKinds(self::KINDS);
    }

    /**
     * @param  list<string>  $kinds
     */
    private function setKinds(array $kinds): void
    {
        $list = implode(', ', array_map(fn (string $kind) => "'{$kind}'", $kinds));

        DB::statement('ALTER TABLE '.DB::getQueryGrammar()->wrapTable('print_jobs')." MODIFY `kind` ENUM({$list}) NOT NULL");
    }
};
