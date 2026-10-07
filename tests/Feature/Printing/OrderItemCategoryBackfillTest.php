<?php

use App\Models\Category;
use App\Models\OrderItem;
use App\Models\Product;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Runs the Phase 4 migration's down() and up() on data. MySQL DDL implicitly commits
 * RefreshDatabase's wrapping transaction, so afterEach() marks the test database as
 * dirty: the next test starts from a fresh `migrate:fresh` (pos_mobile_test only).
 */

beforeEach(function () {
    seedRoles();
    mainBranch();
    Carbon::setTestNow('2026-09-25 04:12:09');
});

afterEach(function () {
    Carbon::setTestNow();
    RefreshDatabaseState::$migrated = false;
});

it('backfills order_items.category_id from the products, then makes it NOT NULL with a RESTRICT foreign key', function () {
    $cashier = userWithRole('cashier');
    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);
    $hotDog = Product::factory()->forCategory($breakfast)->create(['price_cents' => 8000]);
    $icedTea = Product::factory()->forCategory($drinks)->create(['price_cents' => 3500]);

    sell($cashier, [[$hotDog, 1], [$icedTea, 2]]);
    sell($cashier, [[$icedTea, 1]]);

    $migration = require collect(glob(database_path('migrations/*_add_category_id_to_order_items_table.php')))->sole();

    $migration->down();
    expect(Schema::hasColumn('order_items', 'category_id'))->toBeFalse();

    $migration->up();

    expect(OrderItem::query()->orderBy('id')->pluck('category_id')->all())->toBe([$breakfast->id, $drinks->id, $drinks->id]);

    $column = DB::selectOne(
        "SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'category_id'",
    );
    $foreignKey = DB::selectOne(
        "SELECT rc.DELETE_RULE AS delete_rule, rc.REFERENCED_TABLE_NAME AS referenced_table
         FROM information_schema.REFERENTIAL_CONSTRAINTS rc
         JOIN information_schema.KEY_COLUMN_USAGE k
           ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME = 'order_items' AND k.COLUMN_NAME = 'category_id'",
    );

    expect($column->nullable)->toBe('NO')
        ->and($foreignKey->referenced_table)->toBe('categories')
        ->and($foreignKey->delete_rule)->toBe('RESTRICT');
});
