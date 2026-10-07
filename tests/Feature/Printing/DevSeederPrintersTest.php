<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Printer;
use App\Models\PrintRoute;
use Database\Seeders\DevSeeder;

beforeEach(function () {
    seedRoles();
    app()['env'] = 'local';
});

/**
 * @return list<array<string, mixed>>
 */
function seededPrinters(): array
{
    $categoryNames = Category::query()->pluck('name', 'id');

    return Printer::query()->orderBy('id')->get()
        ->map(fn (Printer $p) => [
            $p->name, $p->role, $p->host, $p->port, $p->paper_width_mm, $p->is_enabled, $p->is_default_kitchen,
            $p->routes()->orderBy('category_id')->pluck('category_id')->map(fn (int $id) => $categoryNames[$id])->all(),
        ])
        ->all();
}

it('seeds the Counter, Kitchen and Bar printers in MAIN when DEV_PRINTER_HOST is set, idempotently', function () {
    config(['pos.dev_printer_host' => '192.168.1.7']);

    $this->seed(DevSeeder::class);
    $this->seed(DevSeeder::class);

    $main = Branch::query()->where('code', 'MAIN')->sole();

    expect(seededPrinters())->toBe([
        ['Counter', 'cashier', '192.168.1.7', 9100, 80, true, false, []],
        ['Kitchen', 'kitchen', '192.168.1.7', 9101, 80, true, true, ['Breakfast', 'Meals']],
        ['Bar', 'bar', '192.168.1.7', 9102, 80, true, false, ['Drinks']],
    ])
        ->and(Printer::query()->pluck('branch_id')->unique()->all())->toBe([$main->id])
        ->and(PrintRoute::query()->pluck('branch_id')->unique()->all())->toBe([$main->id])
        ->and(PrintRoute::query()->count())->toBe(3)
        ->and(AuditLog::query()->where('action', 'like', 'printer.%')->count())->toBe(0);
});

it('moves the printers to a new host when re-seeded with another DEV_PRINTER_HOST', function () {
    config(['pos.dev_printer_host' => '192.168.1.7']);
    $this->seed(DevSeeder::class);

    config(['pos.dev_printer_host' => '10.0.0.20']);
    $this->seed(DevSeeder::class);

    expect(Printer::query()->pluck('host')->unique()->all())->toBe(['10.0.0.20'])
        ->and(Printer::query()->count())->toBe(3);
});

it('seeds no printers when DEV_PRINTER_HOST is empty', function (?string $host) {
    config(['pos.dev_printer_host' => $host]);

    $this->seed(DevSeeder::class);

    expect(Printer::query()->count())->toBe(0)
        ->and(PrintRoute::query()->count())->toBe(0)
        ->and(Category::query()->count())->toBe(3); // the rest of the dev seed still runs
})->with([null, '', '   ']);

it('seeds no printers outside the local environment', function () {
    app()['env'] = 'testing';
    config(['pos.dev_printer_host' => '192.168.1.7']);

    $this->seed(DevSeeder::class);

    expect(Printer::query()->count())->toBe(0);
});
