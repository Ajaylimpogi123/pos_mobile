<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Printer;
use App\Models\PrintRoute;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->branch->forceFill(['address' => '123 Rizal St., Makati', 'tin' => '000-123-456-000'])->save();
    $this->otherBranch = Branch::factory()->create(['code' => 'NORTH']);

    Carbon::setTestNow('2026-09-25 02:05:00');

    $this->cashier = userWithRole('cashier');
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * @param  list<Category>  $categories
 */
function routeCategories(Printer $printer, array $categories): void
{
    foreach ($categories as $category) {
        PrintRoute::query()->insert([
            'branch_id' => $printer->branch_id, 'category_id' => $category->id, 'printer_id' => $printer->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}

it('returns 401 without a token', function () {
    $this->getJson('/api/v1/print-config')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
});

it('gives a cashier the full config of their branch, disabled printers included', function () {
    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $meals = Category::factory()->create(['name' => 'Meals']);
    $drinks = Category::factory()->create(['name' => 'Drinks']);

    $kitchen = Printer::factory()->forBranch($this->branch)->create([
        'name' => 'Kitchen', 'host' => '192.168.1.60', 'port' => 9101, 'is_default_kitchen' => true,
    ]);
    routeCategories($kitchen, [$meals, $breakfast]);
    $bar = Printer::factory()->forBranch($this->branch)->bar()->disabled()->create([
        'name' => 'Bar', 'host' => 'bar.local', 'port' => 9102, 'paper_width_mm' => 58,
    ]);
    routeCategories($bar, [$drinks]);
    $counter = Printer::factory()->forBranch($this->branch)->cashier()->create(['name' => 'Counter', 'host' => '192.168.1.59']);

    $response = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')->assertOk();

    expect(array_keys($response->json()))->toBe(['data'])
        ->and(array_keys($response->json('data')))->toBe(['branch', 'settings', 'printers', 'generated_at'])
        ->and(array_keys($response->json('data.settings')))->toBe(branchSettingsKeys())
        ->and(array_keys($response->json('data.printers.0')))->toBe(printerKeys());

    $printer = fn (Printer $p, array $overrides) => [
        'id' => $p->id, 'name' => $p->name, 'role' => $p->role, 'host' => $p->host, 'port' => $p->port,
        'paper_width_mm' => $p->paper_width_mm, 'is_enabled' => $p->is_enabled, 'is_default_kitchen' => $p->is_default_kitchen,
        'category_ids' => [], 'created_at' => '2026-09-25T02:05:00Z', 'updated_at' => '2026-09-25T02:05:00Z', ...$overrides,
    ];

    $response->assertExactJson(['data' => [
        'branch' => ['id' => $this->branch->id, 'name' => 'Main Branch', 'timezone' => 'Asia/Manila'],
        'settings' => [
            'receipt_header_lines' => ['Main Branch', '123 Rizal St., Makati', 'TIN 000-123-456-000'],
            'receipt_footer_lines' => ['This is not an official receipt.'],
            'auto_print_receipt' => true,
            'receipt_copies' => 1,
            'print_kitchen_tickets' => true,
            'dine_in_enabled' => false,
            'service_charge_bps' => 0,
            'reservation_hold_minutes' => 60,
            'updated_at' => null,
        ],
        'printers' => [
            $printer($bar, ['category_ids' => [$drinks->id]]),
            $printer($counter, []),
            $printer($kitchen, ['category_ids' => [$breakfast->id, $meals->id]]),
        ],
        'generated_at' => '2026-09-25T02:05:00Z',
    ]]);
});

it('excludes deleted and other-branch printers, and routes to deleted categories', function () {
    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $gone = Category::factory()->create(['name' => 'Gone']);

    $kitchen = Printer::factory()->forBranch($this->branch)->create(['name' => 'Kitchen']);
    routeCategories($kitchen, [$breakfast, $gone]);
    $gone->delete();

    Printer::factory()->forBranch($this->branch)->create(['name' => 'Deleted'])->delete();
    $elsewhere = Printer::factory()->forBranch($this->otherBranch)->create(['name' => 'Elsewhere']);
    routeCategories($elsewhere, [$breakfast]);

    $printers = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')->assertOk()->json('data.printers');

    expect($printers)->toHaveCount(1)
        ->and($printers[0]['id'])->toBe($kitchen->id)
        ->and($printers[0]['category_ids'])->toBe([$breakfast->id]);
});

it('orders printers by name then id and returns an empty list when there are none', function () {
    $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')
        ->assertOk()
        ->assertJsonPath('data.printers', []);

    $b = Printer::factory()->forBranch($this->branch)->create(['name' => 'B']);
    $a = Printer::factory()->forBranch($this->branch)->create(['name' => 'A']);

    expect(collect($this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')->json('data.printers'))->pluck('id')->all())
        ->toBe([$a->id, $b->id]);
});

it('returns the saved settings of the caller branch', function () {
    $manager = userWithRole('manager');
    $this->withToken(tokenFor($manager))
        ->patchJson('/api/v1/admin/settings', ['receipt_copies' => 2, 'auto_print_receipt' => false])
        ->assertOk();

    $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')
        ->assertOk()
        ->assertJsonPath('data.settings.receipt_copies', 2)
        ->assertJsonPath('data.settings.auto_print_receipt', false)
        ->assertJsonPath('data.settings.updated_at', '2026-09-25T02:05:00Z');
});

it('is available to a user with no permissions at all', function () {
    $nobody = User::factory()->forBranch($this->branch)->create();

    $this->withToken(tokenFor($nobody))->getJson('/api/v1/print-config')->assertOk();
});
