<?php

use App\Models\Branch;
use App\Models\Order;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Database\Seeders\DevSeeder;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    seedRoles();
});

it('seeds opening stock for the track_stock dev products, idempotently, and no orders', function () {
    app()['env'] = 'local';

    $this->seed(DevSeeder::class);
    $this->seed(DevSeeder::class);

    $main = Branch::query()->where('code', 'MAIN')->sole();
    $ownerId = User::query()->where('email', 'owner@pos.test')->value('id');

    $levels = StockLevel::query()->with('product')->orderBy('product_id')->get()
        ->map(fn (StockLevel $level) => [$level->branch_id, $level->product->sku, $level->wholeQty()])
        ->all();

    expect($levels)->toBe([
        [$main->id, 'DRK-001', 50],
        [$main->id, 'DRK-002', 30],
    ]);

    $movements = StockMovement::query()->with('product')->orderBy('product_id')->get()
        ->map(fn (StockMovement $m) => [$m->product->name, $m->type, $m->wholeQtyDelta(), $m->unit_cost_cents, $m->created_by, $m->branch_id])
        ->all();

    expect($movements)->toBe([
        ['Iced Tea', 'opening', 50, 1575, $ownerId, $main->id],
        ['Bottled Water', 'opening', 30, 900, $ownerId, $main->id],
    ])
        ->and(StockMovement::query()->pluck('ulid')->every(fn (string $ulid) => preg_match('/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/', $ulid) === 1))->toBeTrue()
        ->and(Order::query()->count())->toBe(0)
        ->and(DB::table('sequences')->count())->toBe(0);
});

it('does not top the stock back up when re-seeded after it moved', function () {
    app()['env'] = 'local';
    $this->seed(DevSeeder::class);

    $icedTea = Product::query()->where('sku', 'DRK-001')->sole();
    StockLevel::query()->where('product_id', $icedTea->id)->update(['qty' => 45]);

    $this->seed(DevSeeder::class);

    expect(stockOf($icedTea))->toBe(45)
        ->and(StockMovement::query()->where('product_id', $icedTea->id)->count())->toBe(1);
});

it('seeds no stock outside the local environment', function () {
    $this->seed(DevSeeder::class);

    expect(StockLevel::query()->count())->toBe(0)
        ->and(StockMovement::query()->count())->toBe(0);
});
