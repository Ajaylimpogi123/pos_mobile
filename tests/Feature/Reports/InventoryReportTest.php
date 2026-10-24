<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
| The branch is Asia/Manila with a 04:00 day start: business day 2026-09-27 is
| [2026-09-26 20:00:00Z, 2026-09-27 20:00:00Z).
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-28 01:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);
    $this->snacks = Category::factory()->create(['name' => 'Snacks']);

    $make = fn (Category $category, array $attributes) => Product::factory()->forCategory($category)->create(['track_stock' => true, ...$attributes]);

    $this->icedTea = $make($this->drinks, ['name' => 'Iced Tea', 'cost_cents' => 1200]);
    $this->water = $make($this->drinks, ['name' => 'Bottled Water', 'cost_cents' => 1000]);
    $this->chips = $make($this->snacks, ['name' => 'Chips', 'cost_cents' => 500]);
    $make($this->snacks, ['name' => 'Hot Dog', 'track_stock' => false]);
    $make($this->snacks, ['name' => 'Discontinued'])->delete();

    // Iced Tea: one of every type, around the period of business day 2026-09-27.
    $tea = $this->icedTea;
    recordMovement($tea, 'opening', 35, '2026-09-26 19:59:59');   // before the start: opening_qty
    recordMovement($tea, 'receipt', 24, '2026-09-26 20:00:00');   // the very start: in
    recordMovement($tea, 'sale', -50, '2026-09-27 10:00:00');
    recordMovement($tea, 'void', 3, '2026-09-27 10:05:00');
    recordMovement($tea, 'refund', 1, '2026-09-27 10:10:00');
    recordMovement($tea, 'wastage', -2, '2026-09-27 11:00:00');
    recordMovement($tea, 'count', -1, '2026-09-27 12:00:00');
    recordMovement($tea, 'adjustment', 4, '2026-09-27 13:00:00');
    recordMovement($tea, 'opening', 2, '2026-09-27 19:59:59');    // the very end: in
    recordMovement($tea, 'receipt', 100, '2026-09-27 20:00:00');  // the next business day: out

    recordMovement($this->water, 'opening', 10, '2026-09-25 01:00:00');
    setReorderLevel($this->water, 10);
    // Chips: never stocked, so out.
});

afterEach(function () {
    Carbon::setTestNow();
});

function inventoryReport(User $user, string $query, string $path = '/api/v1/reports/inventory'): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson("{$path}?{$query}");
}

/**
 * An inventory report row in the contract's key order.
 *
 * @return array<string, mixed>
 */
function inventoryRow(Product $product, string $category, int $opening, int $received, int $sold, int $returned, int $wasted, int $adjusted, int $closing, ?int $reorderLevel, string $status, int $cost, int $value): array
{
    return [
        'product_id' => $product->id, 'name' => $product->name, 'category_name' => $category,
        'opening_qty' => $opening, 'received' => $received, 'sold' => $sold, 'returned' => $returned, 'wasted' => $wasted,
        'adjusted' => $adjusted, 'closing_qty' => $closing, 'reorder_level' => $reorderLevel, 'status' => $status,
        'unit_cost_cents' => $cost, 'stock_value_cents' => $value,
    ];
}

describe('GET /reports/inventory', function () {
    it('reports each tracked product\'s flow over the business days, with its current stock', function () {
        $response = inventoryReport($this->owner, 'from=2026-09-27&to=2026-09-27')->assertOk();

        // Iced Tea now: 35 + 24 − 50 + 3 + 1 − 2 − 1 + 4 + 2 + 100 = 116.
        expect($response->json())->toBe([
            'data' => [
                'from' => '2026-09-27',
                'to' => '2026-09-27',
                'totals' => [
                    'tracked' => 3, 'low' => 1, 'out' => 1, 'stock_value_cents' => 116 * 1200 + 10 * 1000,
                    'received' => 24, 'sold' => 50, 'returned' => 4, 'wasted' => 2, 'adjusted' => 5,
                ],
                'rows' => [
                    inventoryRow($this->water, 'Drinks', 10, 0, 0, 0, 0, 0, 10, 10, 'low', 1000, 10000),
                    inventoryRow($this->chips, 'Snacks', 0, 0, 0, 0, 0, 0, 0, null, 'out', 500, 0),
                    inventoryRow($this->icedTea, 'Drinks', 35, 24, 50, 4, 2, 5, 16, null, 'in_stock', 1200, 116 * 1200),
                ],
            ],
            'meta' => ['truncated' => false],
        ]);
    });

    it('keeps the invariant opening + received − sold + returned − wasted + adjusted = closing on any period', function (string $from, string $to, array $tea) {
        $rows = collect(inventoryReport($this->owner, "from={$from}&to={$to}")->assertOk()->json('data.rows'))->keyBy('name');

        foreach ($rows as $row) {
            expect($row['opening_qty'] + $row['received'] - $row['sold'] + $row['returned'] - $row['wasted'] + $row['adjusted'])
                ->toBe($row['closing_qty']);
        }

        $row = $rows['Iced Tea'];
        expect([$row['opening_qty'], $row['received'], $row['sold'], $row['returned'], $row['wasted'], $row['adjusted'], $row['closing_qty']])->toBe($tea);
    })->with([
        'the day' => ['2026-09-27', '2026-09-27', [35, 24, 50, 4, 2, 5, 16]],
        'from the day before' => ['2026-09-26', '2026-09-27', [0, 24, 50, 4, 2, 40, 16]],
        'the next day' => ['2026-09-28', '2026-09-28', [16, 100, 0, 0, 0, 0, 116]],
        'both days' => ['2026-09-27', '2026-09-28', [35, 124, 50, 4, 2, 5, 116]],
        'before everything' => ['2026-09-01', '2026-09-02', [0, 0, 0, 0, 0, 0, 0]],
    ]);

    it('counts a movement by the business day, not the UTC date', function () {
        // 2026-09-27 03:59:59 in Manila is still business day 2026-09-26.
        recordMovement($this->chips, 'receipt', 7, '2026-09-27 19:59:59');
        recordMovement($this->chips, 'receipt', 3, '2026-09-26 19:59:59');

        $chips = fn (string $day) => collect(inventoryReport($this->owner, "from={$day}&to={$day}")->assertOk()->json('data.rows'))
            ->firstWhere('name', 'Chips')['received'];

        expect($chips('2026-09-26'))->toBe(3)
            ->and($chips('2026-09-27'))->toBe(7);
    });

    it('filters by category and current status; flow totals follow the rows, stock totals the branch', function () {
        $alerts = inventoryReport($this->owner, 'from=2026-09-27&to=2026-09-27&status=alerts')->assertOk();

        expect(array_column($alerts->json('data.rows'), 'name'))->toBe(['Bottled Water', 'Chips'])
            ->and($alerts->json('data.totals'))->toBe([
                'tracked' => 3, 'low' => 1, 'out' => 1, 'stock_value_cents' => 149200,
                'received' => 0, 'sold' => 0, 'returned' => 0, 'wasted' => 0, 'adjusted' => 0,
            ]);

        $names = fn (string $query) => array_column(inventoryReport($this->owner, 'from=2026-09-27&to=2026-09-27&'.$query)->assertOk()->json('data.rows'), 'name');

        expect($names('status=low'))->toBe(['Bottled Water'])
            ->and($names('status=out'))->toBe(['Chips'])
            ->and($names('status=in_stock'))->toBe(['Iced Tea'])
            ->and($names("category_id={$this->snacks->id}"))->toBe(['Chips'])
            ->and($names("category_id={$this->drinks->id}&status=in_stock"))->toBe(['Iced Tea']);

        expect(inventoryReport($this->owner, "from=2026-09-27&to=2026-09-27&category_id={$this->drinks->id}")->json('data.totals.sold'))->toBe(50);
    });

    it('covers the caller\'s branch only', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        recordMovement($this->chips, 'receipt', 9, '2026-09-27 02:00:00', $north);
        $northOwner = User::factory()->forBranch($north)->withRole('owner')->create();

        $report = inventoryReport($northOwner, 'from=2026-09-27&to=2026-09-27')->assertOk()->json('data');

        expect($report['totals'])->toBe([
            'tracked' => 3, 'low' => 0, 'out' => 2, 'stock_value_cents' => 4500,
            'received' => 9, 'sold' => 0, 'returned' => 0, 'wasted' => 0, 'adjusted' => 0,
        ]);
    });

    it('caps the rows at 500 with meta.truncated, totals over every matching product', function () {
        $many = Category::factory()->create(['name' => 'Many']);
        Product::factory()->count(497)->forCategory($many)->create(['track_stock' => true, 'cost_cents' => 0]);

        $capped = inventoryReport($this->owner, 'from=2026-09-27&to=2026-09-27')->assertOk();
        expect($capped->json('data.rows'))->toHaveCount(500)
            ->and($capped->json('meta.truncated'))->toBeFalse()
            ->and($capped->json('data.totals.tracked'))->toBe(500);

        // "Zz" sorts last, so its flow is past the cap but still in the totals.
        $last = Product::factory()->forCategory($many)->create(['name' => 'Zz Last', 'track_stock' => true]);
        recordMovement($last, 'receipt', 6, '2026-09-27 02:00:00');

        $truncated = inventoryReport($this->owner, 'from=2026-09-27&to=2026-09-27')->assertOk();
        expect($truncated->json('data.rows'))->toHaveCount(500)
            ->and($truncated->json('meta.truncated'))->toBeTrue()
            ->and(array_column($truncated->json('data.rows'), 'name'))->not->toContain('Zz Last')
            ->and($truncated->json('data.totals.received'))->toBe(30);
    });

    it('runs a fixed number of set-based queries', function () {
        $token = tokenFor($this->owner);
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->withToken($token)->getJson('/api/v1/reports/inventory?from=2026-09-01&to=2026-09-30')->assertOk();

        $movementQueries = array_filter(DB::getQueryLog(), fn (array $q) => str_contains($q['query'], DB::getQueryGrammar()->wrapTable('stock_movements')));
        $levelQueries = array_filter(DB::getQueryLog(), fn (array $q) => str_contains($q['query'], DB::getQueryGrammar()->wrapTable('stock_levels')));
        DB::disableQueryLog();

        expect($movementQueries)->toHaveCount(1)
            ->and($levelQueries)->toHaveCount(2);
    });

    it('validates the query', function (string $query, string $field, ?string $message) {
        $response = inventoryReport($this->owner, $query)->assertUnprocessable();

        $message === null
            ? $response->assertJsonValidationErrors([$field])
            : $response->assertJsonValidationErrors([$field => $message]);
    })->with([
        'no from' => ['to=2026-09-27', 'from', 'The from field is required.'],
        'no to' => ['from=2026-09-27', 'to', 'The to field is required.'],
        'bad from' => ['from=27-09-2026&to=2026-09-27', 'from', null],
        'to before from' => ['from=2026-09-27&to=2026-09-26', 'to', 'The to field must be a date after or equal to from.'],
        'too long' => ['from=2025-09-26&to=2026-09-27', 'to', "The range can't be longer than 366 days."],
        'status' => ['from=2026-09-27&to=2026-09-27&status=empty', 'status', null],
        'category' => ['from=2026-09-27&to=2026-09-27&category_id=x', 'category_id', null],
    ]);

    it('accepts 366 days counted inclusively', function () {
        inventoryReport($this->owner, 'from=2025-09-27&to=2026-09-27')->assertOk();
    });

    it('needs report.view', function () {
        $clerk = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('clerk', ['inventory.adjust'])->id]);

        inventoryReport($clerk, 'from=2026-09-27&to=2026-09-27')->assertForbidden()->assertExactJson(['message' => 'This action is unauthorized.']);
        inventoryReport(userWithRole('cashier'), 'from=2026-09-27&to=2026-09-27')->assertForbidden();
        inventoryReport(userWithRole('manager'), 'from=2026-09-27&to=2026-09-27')->assertOk();
    });

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/reports/inventory?from=2026-09-27&to=2026-09-27')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

describe('GET /reports/inventory/export', function () {
    it('returns the report as CSV with a BOM, CRLF lines, pesos and a TOTAL line', function () {
        $response = $this->withToken(tokenFor($this->owner))
            ->get('/api/v1/reports/inventory/export?from=2026-09-27&to=2026-09-27')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=UTF-8')
            ->assertHeader('Content-Disposition', 'attachment; filename="inventory-2026-09-27-2026-09-27.csv"');

        expect($response->getContent())->toBe("\u{FEFF}"
            ."product_id,name,category,opening_qty,received,sold,returned,wasted,adjusted,closing_qty,reorder_level,status,unit_cost,stock_value\r\n"
            ."{$this->water->id},\"Bottled Water\",Drinks,10,0,0,0,0,0,10,10,low,10.00,100.00\r\n"
            ."{$this->chips->id},Chips,Snacks,0,0,0,0,0,0,0,,out,5.00,0.00\r\n"
            ."{$this->icedTea->id},\"Iced Tea\",Drinks,35,24,50,4,2,5,16,,in_stock,12.00,1392.00\r\n"
            ."TOTAL,,,,24,50,4,2,5,,,,,1492.00\r\n");
    });

    it('applies the filters', function () {
        $csv = $this->withToken(tokenFor($this->owner))
            ->get('/api/v1/reports/inventory/export?from=2026-09-27&to=2026-09-27&status=out')
            ->assertOk()
            ->getContent();

        expect(explode("\r\n", trim($csv)))->toHaveCount(3);
    });

    it('returns its errors as JSON, even without an Accept header', function () {
        $token = tokenFor($this->owner);

        $this->withToken($token)->get('/api/v1/reports/inventory/export?from=2026-09-27')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['to' => 'The to field is required.']);

        $this->withToken(tokenFor(userWithRole('cashier')))->get('/api/v1/reports/inventory/export?from=2026-09-27&to=2026-09-27')
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 401 without a token', function () {
        $this->get('/api/v1/reports/inventory/export?from=2026-09-27&to=2026-09-27')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});
