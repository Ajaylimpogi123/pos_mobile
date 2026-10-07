<?php

use App\Actions\Recipes\RecipeStock;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Device;
use App\Models\Ingredient;
use App\Models\Order;
use App\Models\OrderItemComponent;
use App\Models\Product;
use App\Models\RecipeLine;
use App\Models\StockMovement;
use App\Models\User;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * Ingredients, Recipes & Purchasing → J (Round B): depletion when a sale is confirmed (online and
 * offline ingest), the per-line snapshots, void returns, refund waste, the ingredient report and
 * history, and the /sync/stock recipe badges.
 */

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();

    // 12:00 in Manila: business day 2026-09-29.
    Carbon::setTestNow('2026-09-29 04:00:00');

    $this->carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->marco = withPin(userWithRole('manager', ['name' => 'Marco Manager']), '2468');
    $this->owner = userWithRole('owner');

    // One tablet with an open shift (voids and refunds need it).
    $installId = newUlid();
    $this->token = deviceToken($this->carla, $installId);
    $this->marcoToken = deviceToken($this->marco, $installId);
    $this->device = Device::query()->sole();
    $this->shift = openShift($this->token, $this->carla);

    // Worked example J's costs: Flour @ 4.666667 (example H), Egg @ 800, Milk @ 9.5.
    $this->flour = makeIngredient('Flour', 'g', ['cup' => '120']);
    $this->egg = makeIngredient('Egg', 'pc');
    $this->milk = makeIngredient('Milk', 'mL');
    ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '5000.000', 20000);
    ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '25000.000', 120000);
    ingredientMovement($this->egg, StockMovement::TYPE_RECEIPT, '30.000', 24000);
    ingredientMovement($this->milk, StockMovement::TYPE_RECEIPT, '2000.000', 19000);

    $breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $this->water = Product::factory()->forCategory($breakfast)->create(['name' => 'Bottled Water', 'price_cents' => 2000, 'cost_cents' => 900, 'track_stock' => true]);
    stockUp($this->water, 10);

    $this->pancake = Product::factory()->forCategory($breakfast)->stockMode(Product::STOCK_RECIPE)->create(['name' => 'Pancake', 'price_cents' => 12000]);
    $this->combo = Product::factory()->forCategory($breakfast)->stockMode(Product::STOCK_RECIPE)->create(['name' => 'Combo', 'price_cents' => 15000]);

    setRecipe($this->pancake, [[$this->flour, '1.000', 'cup', '120.000'], [$this->egg, '1.000', 'pc', '1.000'], [$this->milk, '0.500', 'cup', '118.294']]);
    setRecipe($this->combo, [[$this->flour, '100.000', 'g', '100.000'], [$this->water, '1.000', 'pc', '1.000']]);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Replace a product's recipe directly: `[component, qty, unit, base_qty]` per line.
 *
 * @param  list<array{0: Ingredient|Product, 1: string, 2: string, 3: string}>  $lines
 */
function setRecipe(Product $product, array $lines): void
{
    RecipeLine::query()->where('product_id', $product->id)->delete();

    foreach ($lines as [$component, $qty, $unit, $base]) {
        (new RecipeLine)->forceFill([
            'product_id' => $product->id,
            'ingredient_id' => $component instanceof Ingredient ? $component->id : null,
            'component_product_id' => $component instanceof Product ? $component->id : null,
            'qty' => $qty,
            'unit' => $unit,
            'base_qty' => $base,
        ])->save();
    }
}

/**
 * The branch's ingredient qty as a 3-decimal string (null when never stocked).
 */
function ingredientQty(Ingredient $ingredient): ?string
{
    return ingredientLevel($ingredient)?->qty;
}

/**
 * The order's movements of a type for an ingredient or product, as [qty_delta, value_cents, unit_cost_cents].
 *
 * @return list<array{0: string, 1: int|null, 2: int|null}>
 */
function movementsOf(Ingredient|Product $item, string $type): array
{
    return StockMovement::query()
        ->where($item instanceof Ingredient ? 'ingredient_id' : 'product_id', $item->id)
        ->where('type', $type)
        ->orderBy('id')
        ->get()
        ->map(fn (StockMovement $m) => [(string) $m->qty_delta, $m->value_cents, $m->unit_cost_cents])
        ->all();
}

/**
 * Sell through POST /orders as Carla, in the open shift.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @return array<string, mixed>
 */
function sellInShift(array $lines): array
{
    return sell(test()->carla, $lines, ['shift_ulid' => test()->shift['ulid']]);
}

describe('depletion on an online sale', function () {
    it('aggregates each component across the order into one sale movement, valued at avg_cost, with per-line snapshots', function () {
        $order = sellInShift([[$this->pancake, 2], [$this->combo, 1], [$this->water, 1]]);

        expect(array_keys($order))->toBe(orderKeys());

        // Flour: 240 + 100 = 340 g, −round(340 × 4.666667) = −1587 (one movement for two lines).
        expect(movementsOf($this->flour, StockMovement::TYPE_SALE))->toBe([['-340.000', -1587, null]])
            ->and(movementsOf($this->egg, StockMovement::TYPE_SALE))->toBe([['-2.000', -1600, null]])
            ->and(movementsOf($this->milk, StockMovement::TYPE_SALE))->toBe([['-236.588', -2248, null]])
            // Water: its own line (Phase 3) and the combo's component, each a sale movement at cost_cents.
            ->and(movementsOf($this->water, StockMovement::TYPE_SALE))->toBe([['-1.000', null, 900], ['-1.000', null, 900]]);

        expect(ingredientQty($this->flour))->toBe('29660.000')
            ->and(ingredientQty($this->egg))->toBe('28.000')
            ->and(ingredientQty($this->milk))->toBe('1763.412')
            ->and(stockOf($this->water))->toBe(8)
            ->and(ingredientLevel($this->flour)->avg_cost)->toBe('4.666667');

        $orderId = Order::query()->where('ulid', $order['ulid'])->value('id');
        $movement = StockMovement::query()->where('ingredient_id', $this->flour->id)->where('type', 'sale')->sole();
        expect($movement->reference_type)->toBe((new Order)->getMorphClass())
            ->and($movement->reference_id)->toBe($orderId)
            ->and($movement->created_by)->toBe($this->carla->id);

        [$pancakeLine, $comboLine, $waterLine] = array_column($order['items'], 'id');
        $snapshots = OrderItemComponent::query()->orderBy('id')->get()
            ->map(fn (OrderItemComponent $c) => [$c->order_item_id, $c->ingredient_id, $c->product_id, (string) $c->base_qty, $c->cost_cents, (string) $c->wasted_base_qty])
            ->all();

        // Flour's line costs are allocated cumulatively: 1120 + 467 = 1587, the movement's value.
        expect($snapshots)->toEqualCanonicalizing([
            [$pancakeLine, $this->flour->id, null, '240.000', 1120, '0.000'],
            [$pancakeLine, $this->egg->id, null, '2.000', 1600, '0.000'],
            [$pancakeLine, $this->milk->id, null, '236.588', 2248, '0.000'],
            [$comboLine, $this->flour->id, null, '100.000', 467, '0.000'],
            [$comboLine, null, $this->water->id, '1.000', 900, '0.000'],
        ])->and(OrderItemComponent::query()->where('order_item_id', $waterLine)->exists())->toBeFalse();

        foreach ([$this->flour, $this->egg, $this->milk] as $ingredient) {
            expectIngredientLedgerConsistent($ingredient);
        }

        expectReconciled();
    });

    it('never blocks: components are never checked and stock may go negative (no 422)', function () {
        $sugar = makeIngredient('Sugar');
        $sweet = Product::factory()->forCategory($this->pancake->category)->stockMode(Product::STOCK_RECIPE)->create(['name' => 'Sweet', 'price_cents' => 5000]);
        setRecipe($sweet, [[$sugar, '50.000', 'g', '50.000']]);
        stockUp($this->water, -10);

        sellInShift([[$sweet, 3], [$this->combo, 2]]);

        expect(ingredientQty($sugar))->toBe('-150.000')
            ->and(movementsOf($sugar, StockMovement::TYPE_SALE))->toBe([['-150.000', 0, null]])
            ->and(stockOf($this->water))->toBe(-2);

        expectReconciled();
    });

    it('keeps the Phase 3 check of own products sold on their own lines only', function () {
        stockUp($this->water, -9);

        // One on hand: its own line of 1 passes; the combo's component isn't checked.
        sellInShift([[$this->water, 1], [$this->combo, 1]]);
        expect(stockOf($this->water))->toBe(-1);

        postOrder($this->carla, simpleSale([[$this->water, 1]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.qty' => 'Only 0 "Bottled Water" left in stock.']);
    });

    it('ignores the recipe of a product that is no longer recipe, and a component that is no longer own', function () {
        $this->pancake->update(['stock_mode' => Product::STOCK_NONE]);
        stockUp($this->water, -10);
        $this->water->update(['stock_mode' => Product::STOCK_NONE]);

        sellInShift([[$this->pancake, 1], [$this->combo, 1]]);

        expect(movementsOf($this->egg, StockMovement::TYPE_SALE))->toBe([])
            ->and(movementsOf($this->flour, StockMovement::TYPE_SALE))->toBe([['-100.000', -467, null]])
            ->and(movementsOf($this->water, StockMovement::TYPE_SALE))->toBe([])
            ->and(OrderItemComponent::query()->count())->toBe(1);
    });

    it('writes nothing extra for a sale without recipe products', function () {
        sellInShift([[$this->water, 2]]);

        expect(OrderItemComponent::query()->count())->toBe(0)
            ->and(StockMovement::query()->whereNotNull('ingredient_id')->where('type', 'sale')->count())->toBe(0);
    });
});

describe('depletion on offline ingest', function () {
    it('depletes with the current recipe at the sale time, never rejecting or flagging it', function () {
        $sale = offlineOrder($this->carla, [[$this->pancake, 1], [$this->combo, 1]], ['shift_ulid' => $this->shift['ulid']]);

        // The recipe changed after the sale was rung up: the current one applies.
        setRecipe($this->pancake, [[$this->egg, '2.000', 'pc', '2.000']]);
        stockUp($this->water, -10);

        syncOrders($this->token, [$sale])->assertOk()->assertJsonPath('data.0.status', 'accepted');

        $order = Order::query()->where('ulid', $sale['ulid'])->sole();
        expect($order->needs_review)->toBeFalse()
            ->and(movementsOf($this->egg, StockMovement::TYPE_SALE))->toBe([['-2.000', -1600, null]])
            ->and(movementsOf($this->flour, StockMovement::TYPE_SALE))->toBe([['-100.000', -467, null]])
            ->and(movementsOf($this->milk, StockMovement::TYPE_SALE))->toBe([])
            ->and(stockOf($this->water))->toBe(-1)
            ->and(StockMovement::query()->where('ingredient_id', $this->egg->id)->where('type', 'sale')->sole()->occurred_at->equalTo($order->placed_at))->toBeTrue()
            ->and(OrderItemComponent::query()->where('order_id', $order->id)->count())->toBe(3);

        // A retry is a duplicate: nothing depletes twice.
        syncOrders($this->token, [$sale])->assertOk()->assertJsonPath('data.0.status', 'duplicate');
        expect(OrderItemComponent::query()->count())->toBe(3);

        expectReconciled();
    });
});

/**
 * The receipt formula (§B), which a void of an ingredient component also applies (Q-032):
 * q = max(qty_before, 0), avg = round_half_up((q × avg + c) / (q + b), 6).
 */
function reweighted(string $qtyBefore, string $avgCost, string $b, int $c): string
{
    $q = BigDecimal::of($qtyBefore)->isNegative() ? BigDecimal::zero() : BigDecimal::of($qtyBefore);

    return (string) $q->multipliedBy($avgCost)->plus($c)->dividedBy($q->plus($b), 6, RoundingMode::HalfUp);
}

describe('void', function () {
    it('returns each component at its snapshot cost and re-weights avg_cost like a receipt, after avg_cost moved', function () {
        $order = sellInShift([[$this->pancake, 2], [$this->combo, 1], [$this->water, 1]]);

        // A later receipt at another price moves Flour's average.
        ingredientMovement($this->flour, StockMovement::TYPE_RECEIPT, '10000.000', 60000);
        $before = ingredientLevel($this->flour);
        expect($before->qty)->toBe('39660.000')
            ->and($before->avg_cost)->toBe(reweighted('29660.000', '4.666667', '10000.000', 60000));

        postVoid($this->marcoToken, $order['ulid'], voidBody())->assertOk()->assertJsonPath('data.status', 'voided');

        expect(movementsOf($this->flour, StockMovement::TYPE_VOID))->toBe([['340.000', 1587, null]])
            ->and(movementsOf($this->egg, StockMovement::TYPE_VOID))->toBe([['2.000', 1600, null]])
            ->and(movementsOf($this->milk, StockMovement::TYPE_VOID))->toBe([['236.588', 2248, null]])
            // Its own line (ReturnOrderStock) and the component, each at 900.
            ->and(movementsOf($this->water, StockMovement::TYPE_VOID))->toEqualCanonicalizing([['1.000', null, 900], ['1.000', null, 900]]);

        // b = 340 g returned at c = 1587 (the snapshot), re-weighted from the moved average.
        expect(ingredientQty($this->flour))->toBe('40000.000')
            ->and(ingredientLevel($this->flour)->avg_cost)->toBe(reweighted('39660.000', $before->avg_cost, '340.000', 1587))
            ->and(ingredientQty($this->egg))->toBe('30.000')
            ->and(ingredientQty($this->milk))->toBe('2000.000')
            ->and(stockOf($this->water))->toBe(10);

        $void = StockMovement::query()->where('ingredient_id', $this->flour->id)->where('type', 'void')->sole();
        expect($void->reference_id)->toBe(Order::query()->where('ulid', $order['ulid'])->value('id'))
            ->and($void->created_by)->toBe($this->marco->id);

        // Σ value_cents reconciles with round_half_up(max(qty, 0) × avg_cost) for every ingredient.
        foreach ([$this->flour, $this->egg, $this->milk] as $ingredient) {
            expectIngredientLedgerConsistent($ingredient);
        }

        expectReconciled();
    });

    it('restores qty exactly, and avg_cost up to the rounding of the sale value, when nothing happened in between', function () {
        $order = sellInShift([[$this->pancake, 2], [$this->combo, 1]]);

        postVoid($this->marcoToken, $order['ulid'], voidBody())->assertOk();

        expect(ingredientQty($this->flour))->toBe('30000.000')
            ->and(ingredientQty($this->egg))->toBe('30.000')
            ->and(ingredientQty($this->milk))->toBe('2000.000')
            ->and(stockOf($this->water))->toBe(10)
            // Egg's sale value was exact (2 × 800), so its average comes back exactly.
            ->and(ingredientLevel($this->egg)->avg_cost)->toBe('800.000000')
            // Flour (340 × 4.666667 = 1586.667 → 1587) and Milk (236.588 × 9.5 = 2247.586 → 2248) follow
            // the formula; the difference is the sale value's rounding spread over the stock.
            ->and(ingredientLevel($this->flour)->avg_cost)->toBe(reweighted('29660.000', '4.666667', '340.000', 1587))
            ->and(ingredientLevel($this->milk)->avg_cost)->toBe(reweighted('1763.412', '9.500000', '236.588', 2248));

        foreach ([[$this->flour, '4.666667', '30000'], [$this->milk, '9.500000', '2000']] as [$ingredient, $original, $qty]) {
            $drift = BigDecimal::of(ingredientLevel($ingredient)->avg_cost)->minus($original)->abs();
            expect($drift->isLessThanOrEqualTo(BigDecimal::of('0.5')->dividedBy($qty, 6, RoundingMode::Up)->plus('0.000001')))->toBeTrue();
            expectIngredientLedgerConsistent($ingredient);
        }

        expectIngredientLedgerConsistent($this->egg);
        expectReconciled();
    });
});

describe('refund', function () {
    beforeEach(function () {
        $this->order = sellInShift([[$this->pancake, 3]]);
        $this->line = $this->order['items'][0]['id'];
        Carbon::setTestNow('2026-09-29 05:00:00');
    });

    it('writes no stock movement and adds the refunded share to wasted_base_qty, cumulatively', function () {
        $movements = StockMovement::query()->count();

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->line, 1]], [['method' => 'cash', 'amount_cents' => 12000]]))->assertCreated();

        expect(StockMovement::query()->count())->toBe($movements)
            ->and(ingredientQty($this->flour))->toBe('29640.000')
            ->and(OrderItemComponent::query()->orderBy('id')->pluck('wasted_base_qty')->map(fn ($q) => (string) $q)->all())
            ->toBe(['120.000', '1.000', '118.294']);

        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->line, 2]], [['method' => 'cash', 'amount_cents' => 24000]]))->assertCreated();

        // Fully refunded: exactly the line's base_qty is wasted, and still no movement.
        expect(StockMovement::query()->count())->toBe($movements)
            ->and(OrderItemComponent::query()->orderBy('id')->get()->map(fn ($c) => [(string) $c->base_qty, (string) $c->wasted_base_qty])->all())
            ->toBe([['360.000', '360.000'], ['3.000', '3.000'], ['354.882', '354.882']]);

        $refunds = DB::table('refunds')->orderBy('id')->pluck('id')->all();
        $wastes = DB::table('refund_item_components')->orderBy('id')->get();
        expect($wastes)->toHaveCount(6)
            ->and($wastes->pluck('refund_id')->unique()->values()->all())->toBe($refunds)
            ->and($wastes->where('ingredient_id', $this->milk->id)->pluck('base_qty')->map(fn ($q) => (string) $q)->values()->all())->toBe(['118.294', '236.588']);

        expectReconciled();
    });

    it('splits a base quantity by the cumulative refund formula', function () {
        $base = BigDecimal::of('1.000');
        $shares = [];

        foreach ([[0, 1], [1, 1], [2, 1]] as [$p, $k]) {
            $shares[] = (string) RecipeStock::share($base, $p + $k, 3)->minus(RecipeStock::share($base, $p, 3));
        }

        expect($shares)->toBe(['0.333', '0.334', '0.333']);
    });

    it('shows the refund as wasted instead of used in the ingredient report', function () {
        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->line, 1]], [['method' => 'cash', 'amount_cents' => 12000]]))->assertCreated();

        $rows = collect($this->withToken(tokenFor($this->owner))
            ->getJson('/api/v1/reports/inventory?kind=ingredients&from=2026-09-29&to=2026-09-29')
            ->assertOk()
            ->json('data.rows'))->keyBy('name');

        expect($rows['Flour'])->toMatchArray([
            'opening_qty' => '0.000', 'received' => '30000.000', 'used' => '240.000', 'returned' => '0.000',
            'wasted' => '120.000', 'adjusted' => '0.000', 'closing_qty' => '29640.000',
        ])->and($rows['Milk'])->toMatchArray(['used' => '236.588', 'wasted' => '118.294', 'closing_qty' => '1645.118'])
            ->and($rows['Egg'])->toMatchArray(['used' => '2.000', 'wasted' => '1.000', 'closing_qty' => '27.000']);

        foreach ($rows as $row) {
            $closing = BigDecimal::of($row['opening_qty'])->plus($row['received'])->minus($row['used'])
                ->plus($row['returned'])->minus($row['wasted'])->plus($row['adjusted']);
            expect((string) $closing)->toBe($row['closing_qty']);
        }

        // Before the refund's day, the sale counts as used in full.
        Carbon::setTestNow('2026-09-30 05:00:00');
        $earlier = collect($this->withToken(tokenFor($this->owner))
            ->getJson('/api/v1/reports/inventory?kind=ingredients&from=2026-09-28&to=2026-09-28')
            ->assertOk()->json('data.rows'))->keyBy('name');
        expect($earlier['Flour']['used'])->toBe('0.000');
    });

    it('shows the refund as a wastage entry in the ingredient history, without moving the balance', function () {
        postRefund($this->marcoToken, $this->order['ulid'], refundBody($this->shift['ulid'], [[$this->line, 1]], [['method' => 'cash', 'amount_cents' => 12000]]))->assertCreated();
        $refundUlid = DB::table('refunds')->value('ulid');

        $items = $this->withToken(tokenFor($this->owner))
            ->getJson('/api/v1/inventory/ingredients/'.$this->flour->id.'/movements')
            ->assertOk()
            ->json('data');

        expect($items[0])->toBe([
            'ulid' => $refundUlid,
            'type' => 'wastage',
            'qty_delta' => '0.000',
            'qty_after' => '29640.000',
            'entered_qty' => '120.000',
            'entered_unit' => 'g',
            'unit_cost_cents' => null,
            'value_cents' => 0,
            'reason' => 'Refund '.$this->order['invoice_no'].': Wrong drink',
            'occurred_at' => '2026-09-29T05:00:00Z',
            'created_by' => ['id' => $this->marco->id, 'name' => 'Marco Manager'],
            'reference' => ['kind' => 'refund', 'ulid' => $this->order['ulid'], 'label' => $this->order['invoice_no']],
        ])->and($items[1])->toMatchArray([
            'type' => 'sale', 'qty_delta' => '-360.000', 'qty_after' => '29640.000', 'value_cents' => -1680,
            'reference' => ['kind' => 'order', 'ulid' => $this->order['ulid'], 'label' => $this->order['invoice_no']],
        ])->and($items)->toHaveCount(4);

        $wastage = $this->withToken(tokenFor($this->owner))
            ->getJson('/api/v1/inventory/ingredients/'.$this->flour->id.'/movements?type=wastage')
            ->assertOk()->json('data');
        expect(array_column($wastage, 'ulid'))->toBe([$refundUlid]);

        // Cursor pagination walks every entry once.
        $page = $this->withToken(tokenFor($this->owner))->getJson('/api/v1/inventory/ingredients/'.$this->flour->id.'/movements?per_page=1')->assertOk();
        $next = $this->withToken(tokenFor($this->owner))->getJson($page->json('links.next'))->assertOk();
        expect($page->json('data.0.ulid'))->toBe($refundUlid)
            ->and($next->json('data.0.type'))->toBe('sale');
    });
});

describe('GET /sync/stock recipes', function () {
    it('lists every recipe product: check when a component is out, ok otherwise', function () {
        $empty = Product::factory()->forCategory($this->pancake->category)->stockMode(Product::STOCK_RECIPE)->create(['name' => 'No Recipe Yet']);
        $gone = Product::factory()->forCategory($this->pancake->category)->stockMode(Product::STOCK_RECIPE)->create();
        $gone->delete();

        $recipes = fn () => $this->withToken(tokenFor($this->carla))->getJson('/api/v1/sync/stock')->assertOk()->json('data.recipes');

        expect($recipes())->toBe([
            ['product_id' => $this->pancake->id, 'status' => 'ok'],
            ['product_id' => $this->combo->id, 'status' => 'ok'],
            ['product_id' => $empty->id, 'status' => 'ok'],
        ]);

        // Egg runs out: the pancake needs a check. Water (a product component) runs out: the combo too.
        ingredientMovement($this->egg, StockMovement::TYPE_WASTAGE, '-30.000');
        stockUp($this->water, -10);

        expect(array_column($recipes(), 'status', 'product_id'))->toBe([
            $this->pancake->id => 'check', $this->combo->id => 'check', $empty->id => 'ok',
        ]);

        // A component product that no longer tracks stock doesn't count.
        $this->water->update(['stock_mode' => Product::STOCK_NONE]);
        expect(array_column($recipes(), 'status', 'product_id')[$this->combo->id])->toBe('ok');
    });

    it('counts a missing level of the caller\'s branch as out', function () {
        $north = Branch::factory()->create(['code' => 'NORTH']);
        $northCashier = User::factory()->forBranch($north)->withRole('cashier')->create();

        expect($this->withToken(tokenFor($northCashier))->getJson('/api/v1/sync/stock')->assertOk()->json('data.recipes'))->toBe([
            ['product_id' => $this->pancake->id, 'status' => 'check'],
            ['product_id' => $this->combo->id, 'status' => 'check'],
        ]);
    });
});
