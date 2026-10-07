<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The contract's unit catalog (Ingredients, Recipes & Purchasing → A. Units), with the
     * exact factors to the dimension's base unit (`g`, `mL`, `pc`). Read-only reference data,
     * the same in every environment, so it is written here rather than by a seeder.
     *
     * @var list<array{0: string, 1: string, 2: string, 3: string}>
     */
    private const UNITS = [
        ['mg', 'Milligram', 'mass', '0.001'],
        ['g', 'Gram', 'mass', '1'],
        ['kg', 'Kilogram', 'mass', '1000'],
        ['oz', 'Ounce', 'mass', '28.349523125'],
        ['lb', 'Pound', 'mass', '453.59237'],
        ['mL', 'Milliliter', 'volume', '1'],
        ['L', 'Liter', 'volume', '1000'],
        ['tsp', 'Teaspoon', 'volume', '4.92892159375'],
        ['tbsp', 'Tablespoon', 'volume', '14.78676478125'],
        ['fl oz', 'Fluid ounce', 'volume', '29.5735295625'],
        ['cup', 'Cup (US)', 'volume', '236.5882365'],
        ['pt', 'Pint', 'volume', '473.176473'],
        ['qt', 'Quart', 'volume', '946.352946'],
        ['gal', 'Gallon', 'volume', '3785.411784'],
        ['pc', 'Piece', 'count', '1'],
        ['dozen', 'Dozen', 'count', '12'],
        ['half dozen', 'Half dozen', 'count', '6'],
    ];

    /**
     * Run the migrations.
     *
     * `factor_to_base` is exact (DECIMAL(24,12): the catalog's longest factor has 11
     * decimals). `code` is compared case-sensitively (binary collation), as in the contract.
     */
    public function up(): void
    {
        Schema::create('units', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->collation('utf8mb4_bin')->unique();
            $table->string('name', 40);
            $table->enum('dimension', ['mass', 'volume', 'count']);
            $table->decimal('factor_to_base', 24, 12);
            $table->unsignedSmallInteger('sort_order');
            $table->timestamps();
        });

        $now = now();

        DB::table('units')->insert(array_map(fn (array $unit, int $i) => [
            'code' => $unit[0],
            'name' => $unit[1],
            'dimension' => $unit[2],
            'factor_to_base' => $unit[3],
            'sort_order' => $i + 1,
            'created_at' => $now,
            'updated_at' => $now,
        ], self::UNITS, array_keys(self::UNITS)));
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('units');
    }
};
