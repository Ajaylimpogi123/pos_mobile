<?php

namespace App\Actions\Recipes;

use App\Actions\Inventory\RecordStockMovementAction;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderItemComponent;
use App\Models\Product;
use App\Models\RecipeLine;
use App\Models\Refund;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Recipe depletion and its reversals (Ingredients, Recipes & Purchasing → J; PROJECT_MEMORY §4.6),
 * inside the caller's transaction. Set-based: one read of the recipes of every product of the
 * order, one upsert and one locking read per kind of level, one INSERT of the movements and one of
 * the snapshots, and one UPDATE of the levels.
 *
 * **Sale** (online and offline ingest, with the **current** recipe): for every line whose product
 * is `recipe`, each component's `base_qty × line qty` is summed per component across the order;
 * one `sale` movement per component (an ingredient valued at its `avg_cost`:
 * `−round_half_up(b × avg_cost, 0)`; an `own` product at its `cost_cents` as `unit_cost_cents`).
 * It **never blocks**: stock may go negative, and nothing is checked. A product component that is
 * no longer `own` is skipped (it has no stock of its own). The per-line snapshot
 * (`order_item_components`) keeps `base_qty` and `cost_cents`; an ingredient's line costs are
 * allocated cumulatively (`round(cum_i × avg) − round(cum_{i−1} × avg)`), so they add up exactly to
 * the movement's value.
 *
 * **Void**: each component's snapshot quantity comes back in one `void` movement per component at
 * the snapshot cost. An ingredient's `value_cents` = `c` = Σ `cost_cents`, and its `avg_cost` is
 * re-weighted with the receipt formula (Q-032): `q = max(qty_before, 0)`,
 * `avg_cost = round_half_up((q × avg_cost + c) / (q + b), 6)` for the returned `b`.
 *
 * **Refund** of `k` of a line's `n` units (`p` already refunded): no stock moves. Each snapshot's
 * `wasted_base_qty` grows by `round_half_up(base_qty × (p + k) / n, 3) − round_half_up(base_qty ×
 * p / n, 3)` (cumulative, so a line refunded in full wastes exactly its `base_qty`), recorded per
 * refund in `refund_item_components` for the ingredient report and history.
 *
 * Level quantities are updated relatively (`qty = qty + Δ`), so a product that is both sold on its
 * own line and a component stays exact whichever writer ran first.
 */
class RecipeStock
{
    /**
     * Reads the recipes of the lines' `recipe` products and locks the levels of their components
     * (products, then ingredients, each in id order), created at 0 when missing. Call it before
     * the sale's sequences are allocated. No query when no line is a recipe product.
     *
     * @param  list<array{product_id: int, qty: int}>  $lines
     * @param  Collection<int, Product>  $products  The lines' products keyed by id
     */
    public function prepare(int $branchId, array $lines, Collection $products): RecipeDepletion
    {
        $recipeProductIds = [];

        foreach ($lines as $line) {
            if ($products->get($line['product_id'])?->stock_mode === Product::STOCK_RECIPE) {
                $recipeProductIds[$line['product_id']] = true;
            }
        }

        if ($recipeProductIds === []) {
            return RecipeDepletion::none($branchId);
        }

        $rows = DB::table('recipe_lines')
            ->leftJoin('products as components', 'components.id', '=', 'recipe_lines.component_product_id')
            ->whereIn('recipe_lines.product_id', array_keys($recipeProductIds))
            ->where(fn ($query) => $query
                ->whereNotNull('recipe_lines.ingredient_id')
                ->orWhere('components.stock_mode', Product::STOCK_OWN))
            ->orderBy('recipe_lines.id')
            ->get([
                'recipe_lines.product_id', 'recipe_lines.ingredient_id', 'recipe_lines.component_product_id',
                'recipe_lines.base_qty', 'components.cost_cents',
            ]);

        $components = [];
        $ingredientIds = [];
        $productIds = [];

        foreach ($rows as $row) {
            $isIngredient = $row->ingredient_id !== null;
            $id = (int) ($isIngredient ? $row->ingredient_id : $row->component_product_id);

            $components[(int) $row->product_id][] = [
                'type' => $isIngredient ? RecipeLine::COMPONENT_INGREDIENT : RecipeLine::COMPONENT_PRODUCT,
                'id' => $id,
                'base_qty' => BigDecimal::of((string) $row->base_qty),
                'unit_cost_cents' => $isIngredient ? null : (int) $row->cost_cents,
            ];

            if ($isIngredient) {
                $ingredientIds[] = $id;
            } else {
                $productIds[] = $id;
            }
        }

        return new RecipeDepletion(
            branchId: $branchId,
            components: $components,
            productLevels: StockLevel::lockOrCreateMany($branchId, 'product_id', $productIds),
            ingredientLevels: StockLevel::lockOrCreateMany($branchId, 'ingredient_id', $ingredientIds),
        );
    }

    /**
     * Writes the depletion of a recorded order: the `sale` movements, the snapshots and the levels.
     *
     * @param  iterable<OrderItem>  $items  The order's lines as inserted
     */
    public function deplete(RecipeDepletion $plan, Order $order, iterable $items, ?User $actor, CarbonInterface $occurredAt): void
    {
        if ($plan->isEmpty()) {
            return;
        }

        /** @var array<string, array{type: string, id: int, unit_cost_cents: int|null, total: BigDecimal, lines: list<array{0: OrderItem, 1: BigDecimal}>}> $perComponent */
        $perComponent = [];

        foreach ($items as $item) {
            foreach ($plan->components[$item->product_id] ?? [] as $component) {
                $key = $component['type'].':'.str_pad((string) $component['id'], 20, '0', STR_PAD_LEFT);
                $lineBase = $component['base_qty']->multipliedBy($item->wholeQty());

                $perComponent[$key] ??= [
                    'type' => $component['type'],
                    'id' => $component['id'],
                    'unit_cost_cents' => $component['unit_cost_cents'],
                    'total' => BigDecimal::zero(),
                    'lines' => [],
                ];
                $perComponent[$key]['total'] = $perComponent[$key]['total']->plus($lineBase);
                $perComponent[$key]['lines'][] = [$item, $lineBase];
            }
        }

        ksort($perComponent);

        $movements = [];
        $snapshots = [];
        $deltas = [];
        $now = now();

        foreach ($perComponent as $component) {
            $isIngredient = $component['type'] === RecipeLine::COMPONENT_INGREDIENT;

            if ($isIngredient) {
                $level = $plan->ingredientLevels->get($component['id']);
                $avgCost = BigDecimal::of((string) $level->avg_cost);
                $cumulative = BigDecimal::zero();
                $valued = 0;

                foreach ($component['lines'] as [$item, $lineBase]) {
                    $cumulative = $cumulative->plus($lineBase);
                    $upTo = RecordStockMovementAction::valueAt($cumulative, $avgCost);
                    $snapshots[] = $this->snapshot($order, $item, $component, $lineBase, $upTo - $valued, $now);
                    $valued = $upTo;
                }

                $movements[] = $this->movement($order, $component, StockMovement::TYPE_SALE, $component['total']->negated(), null, -$valued, $actor, $occurredAt, $now);
            } else {
                $level = $plan->productLevels->get($component['id']);
                $unitCost = (int) $component['unit_cost_cents'];

                foreach ($component['lines'] as [$item, $lineBase]) {
                    $snapshots[] = $this->snapshot($order, $item, $component, $lineBase, $lineBase->multipliedBy($unitCost)->toInt(), $now);
                }

                $movements[] = $this->movement($order, $component, StockMovement::TYPE_SALE, $component['total']->negated(), $unitCost, null, $actor, $occurredAt, $now);
            }

            $deltas[$level->id] = $component['total']->negated();
        }

        DB::table('stock_movements')->insert($movements);
        DB::table('order_item_components')->insert($snapshots);
        $this->applyDeltas($deltas, $now);
    }

    /**
     * A voided order's components come back: one `void` movement per component, for the snapshots'
     * Σ base_qty at their Σ cost_cents. An ingredient's `avg_cost` is re-weighted as for a receipt
     * (RecordStockMovementAction::averageAfterReceipt(), from the level locked here), in one UPDATE.
     * No query beyond the snapshot read when the order had none.
     */
    public function returnVoided(Order $order, ?User $actor, CarbonInterface $occurredAt): void
    {
        $rows = DB::table('order_item_components')
            ->where('order_id', $order->id)
            ->groupBy('ingredient_id', 'product_id')
            ->orderBy('product_id')
            ->orderBy('ingredient_id')
            ->select(['ingredient_id', 'product_id'])
            ->selectRaw('SUM(base_qty) AS base_qty')
            ->selectRaw('SUM(cost_cents) AS cost_cents')
            ->get();

        if ($rows->isEmpty()) {
            return;
        }

        $productLevels = StockLevel::lockOrCreateMany($order->branch_id, 'product_id', $rows->whereNotNull('product_id')->pluck('product_id')->map(fn ($id) => (int) $id)->all());
        $ingredientLevels = StockLevel::lockOrCreateMany($order->branch_id, 'ingredient_id', $rows->whereNotNull('ingredient_id')->pluck('ingredient_id')->map(fn ($id) => (int) $id)->all());

        $movements = [];
        $deltas = [];
        $averages = [];
        $now = now();

        foreach ($rows as $row) {
            $isIngredient = $row->ingredient_id !== null;
            $qty = BigDecimal::of((string) $row->base_qty);
            $cost = (int) $row->cost_cents;
            $component = [
                'type' => $isIngredient ? RecipeLine::COMPONENT_INGREDIENT : RecipeLine::COMPONENT_PRODUCT,
                'id' => (int) ($isIngredient ? $row->ingredient_id : $row->product_id),
            ];

            if ($isIngredient) {
                $level = $ingredientLevels->get($component['id']);
                $movements[] = $this->movement($order, $component, StockMovement::TYPE_VOID, $qty, null, $cost, $actor, $occurredAt, $now);
                $averages[$level->id] = RecordStockMovementAction::averageAfterReceipt(
                    BigDecimal::of((string) $level->qty),
                    BigDecimal::of((string) $level->avg_cost),
                    $qty,
                    $cost,
                );
            } else {
                $level = $productLevels->get($component['id']);
                $unitCost = Quantity::roundToInt(BigDecimal::of($cost)->dividedBy($qty, Quantity::SCALE, RoundingMode::HalfUp));
                $movements[] = $this->movement($order, $component, StockMovement::TYPE_VOID, $qty, $unitCost, null, $actor, $occurredAt, $now);
            }

            $deltas[$level->id] = $qty;
        }

        DB::table('stock_movements')->insert($movements);
        $this->applyDeltas($deltas, $now);
        $this->updateColumn('stock_levels', 'avg_cost', $averages, $now, relative: false, scale: Quantity::COST_SCALE);
    }

    /**
     * A refund's share of its lines' components, recorded as wasted (no stock movement).
     *
     * @param  list<array{refund_item_id: int, item: OrderItem, qty: int, refunded_before: int}>  $lines
     */
    public function recordRefundWaste(Refund $refund, array $lines, CarbonInterface $occurredAt): void
    {
        $snapshots = OrderItemComponent::query()
            ->whereIn('order_item_id', array_map(fn (array $line) => $line['item']->id, $lines))
            ->orderBy('id')
            ->get()
            ->groupBy('order_item_id');

        if ($snapshots->isEmpty()) {
            return;
        }

        $rows = [];
        $wasted = [];
        $now = now();

        foreach ($lines as $line) {
            $item = $line['item'];
            $n = $item->wholeQty();
            $before = $line['refunded_before'];

            /** @var OrderItemComponent $snapshot */
            foreach ($snapshots->get($item->id, []) as $snapshot) {
                $base = BigDecimal::of((string) $snapshot->base_qty);
                $share = self::share($base, $before + $line['qty'], $n)->minus(self::share($base, $before, $n));

                if ($share->isZero()) {
                    continue;
                }

                $wasted[$snapshot->id] = BigDecimal::of((string) ($wasted[$snapshot->id] ?? $snapshot->wasted_base_qty))->plus($share);
                $rows[] = [
                    'refund_id' => $refund->id,
                    'refund_item_id' => $line['refund_item_id'],
                    'order_item_component_id' => $snapshot->id,
                    'branch_id' => $snapshot->branch_id,
                    'ingredient_id' => $snapshot->ingredient_id,
                    'product_id' => $snapshot->product_id,
                    'base_qty' => (string) $share,
                    'occurred_at' => $occurredAt,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        if ($rows === []) {
            return;
        }

        DB::table('refund_item_components')->insert($rows);
        $this->updateColumn('order_item_components', 'wasted_base_qty', $wasted, $now, relative: false);
    }

    /**
     * The cumulative refunded share of a quantity: round_half_up(base × m / n, 3).
     */
    public static function share(BigDecimal $base, int $m, int $n): BigDecimal
    {
        if ($n <= 0) {
            return BigDecimal::zero()->toScale(Quantity::SCALE);
        }

        return $base->multipliedBy($m)->dividedBy($n, Quantity::SCALE, RoundingMode::HalfUp);
    }

    /**
     * @param  array{type: string, id: int, unit_cost_cents?: int|null, total?: BigDecimal, lines?: array<mixed>}  $component
     * @return array<string, mixed>
     */
    private function snapshot(Order $order, OrderItem $item, array $component, BigDecimal $baseQty, int $costCents, CarbonInterface $now): array
    {
        $isIngredient = $component['type'] === RecipeLine::COMPONENT_INGREDIENT;

        return [
            'order_id' => $order->id,
            'order_item_id' => $item->id,
            'branch_id' => $order->branch_id,
            'ingredient_id' => $isIngredient ? $component['id'] : null,
            'product_id' => $isIngredient ? null : $component['id'],
            'base_qty' => (string) $baseQty->toScale(Quantity::SCALE),
            'cost_cents' => $costCents,
            'wasted_base_qty' => '0.000',
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }

    /**
     * A ledger row referencing the order (RecordStockMovementAction's columns).
     *
     * @param  array{type: string, id: int}  $component
     * @return array<string, mixed>
     */
    private function movement(Order $order, array $component, string $type, BigDecimal $qtyDelta, ?int $unitCostCents, ?int $valueCents, ?User $actor, CarbonInterface $occurredAt, CarbonInterface $now): array
    {
        $isIngredient = $component['type'] === RecipeLine::COMPONENT_INGREDIENT;

        return [
            'ulid' => (string) Str::ulid(),
            'branch_id' => $order->branch_id,
            'product_id' => $isIngredient ? null : $component['id'],
            'ingredient_id' => $isIngredient ? $component['id'] : null,
            'type' => $type,
            'qty_delta' => (string) $qtyDelta->toScale(Quantity::SCALE),
            'entered_qty' => null,
            'entered_unit' => null,
            'unit_cost_cents' => $unitCostCents,
            'value_cents' => $valueCents,
            'reference_type' => $order->getMorphClass(),
            'reference_id' => $order->id,
            'reason' => null,
            'occurred_at' => $occurredAt,
            'created_by' => $actor?->id,
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }

    /**
     * `qty = qty + Δ` on each locked level, in one statement.
     *
     * @param  array<int, BigDecimal>  $deltas  Keyed by level id
     */
    private function applyDeltas(array $deltas, CarbonInterface $now): void
    {
        $this->updateColumn('stock_levels', 'qty', $deltas, $now, relative: true);
    }

    /**
     * One UPDATE of a decimal column by id: `column = [column +] CASE id WHEN … THEN … END`.
     *
     * @param  array<int, BigDecimal>  $values  Keyed by row id
     */
    private function updateColumn(string $table, string $column, array $values, CarbonInterface $now, bool $relative, int $scale = Quantity::SCALE): void
    {
        if ($values === []) {
            return;
        }

        $cases = '';
        $bindings = [];

        foreach ($values as $id => $value) {
            // Exact DECIMAL arithmetic (a bound string would otherwise turn it into a DOUBLE).
            $cases .= $scale === Quantity::COST_SCALE ? ' WHEN ? THEN CAST(? AS DECIMAL(20,6))' : ' WHEN ? THEN CAST(? AS DECIMAL(15,3))';
            $bindings[] = $id;
            $bindings[] = (string) $value->toScale($scale, RoundingMode::HalfUp);
        }

        $ids = array_keys($values);
        $placeholders = implode(', ', array_fill(0, count($ids), '?'));
        $expression = ($relative ? "`{$column}` + " : '')."CASE `id`{$cases} END";

        DB::update(
            "UPDATE `{$table}` SET `{$column}` = {$expression}, `updated_at` = ? WHERE `id` IN ({$placeholders})",
            [...$bindings, $now, ...$ids],
        );
    }
}
