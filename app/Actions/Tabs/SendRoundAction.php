<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Sales\CompleteSaleAction;
use App\Exceptions\ConflictException;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Sends a round to the kitchen (POST /api/v1/tabs/{ulid}/rounds, Dine-in Tables & Tabs →
 * D.4). Checks, in order (the first failure wins):
 *
 * - **Menu:** the same as `POST /orders` check 2, with the same messages
 *   (CompleteSaleAction::checkMenu()).
 * - Then, in one transaction under the tab's row lock (`409` when it isn't open):
 *   - **Stock:** the `stock_levels` rows of the `track_stock` products are locked, and each
 *     product's demand is this round's quantity **plus** its `remaining_qty` on every open
 *     tab of the branch. Above on-hand: `422` on each of its lines' `items.{i}.qty`,
 *     `Only <n> "<name>" left in stock.`, where n = on-hand − already on open tabs, never
 *     below 0. Nothing is depleted here: stock moves at settlement.
 *   - **200-line cap:** `422` on `items`.
 *
 * On success the lines are added with `round_no` = `rounds_count + 1` and the product
 * snapshots (name, category, sku, price, VAT flag), and `tab.round_sent` is audited.
 */
class SendRoundAction
{
    public const MESSAGE_TOO_MANY_LINES = 'This bill has too many lines. Settle part of it first.';

    public function __construct(
        private readonly CompleteSaleAction $completeSale,
        private readonly LockOpenTab $lockOpenTab,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated SendRoundRequest input
     * @return array{tab: Tab, round_no: int}
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(Tab $tab, User $actor, array $input, ?string $ip = null): array
    {
        LockOpenTab::ensureOpen($tab);

        $lines = array_map(fn (array $item) => [
            'product_id' => (int) $item['product_id'],
            'qty' => (int) $item['qty'],
            'notes' => $item['notes'] ?? null,
        ], array_values($input['items']));

        $products = $this->completeSale->checkMenu($lines);

        return DB::transaction(fn (): array => $this->record($tab, $actor, $lines, $products, $ip), 3);
    }

    /**
     * @param  list<array{product_id: int, qty: int, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     * @return array{tab: Tab, round_no: int}
     */
    private function record(Tab $tab, User $actor, array $lines, Collection $products, ?string $ip): array
    {
        $locked = $this->lockOpenTab->execute($tab);

        $this->checkStock($locked->branch_id, $lines, $products);

        if (TabItem::query()->where('tab_id', $locked->id)->count() + count($lines) > Tab::MAX_LINES) {
            throw ValidationException::withMessages(['items' => self::MESSAGE_TOO_MANY_LINES]);
        }

        $roundNo = $locked->rounds_count + 1;
        $now = now()->startOfSecond();

        foreach ($lines as $line) {
            $product = $products->get($line['product_id']);

            (new TabItem)->forceFill([
                'tab_id' => $locked->id,
                'round_no' => $roundNo,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'category_id' => $product->category_id,
                'category_name' => $product->category->name,
                'sku' => $product->sku,
                'unit_price_cents' => $product->price_cents,
                'is_vatable' => $product->is_vatable,
                'qty' => $line['qty'],
                'notes' => $line['notes'],
                'added_by' => $actor->id,
                'added_at' => $now,
            ])->save();
        }

        $locked->forceFill(['rounds_count' => $roundNo])->save();

        $this->recordAuditLog->execute(
            action: 'tab.round_sent',
            actor: $actor,
            subject: $locked,
            changes: [
                'round_no' => $roundNo,
                'items' => array_map(fn (array $line) => ['product_id' => $line['product_id'], 'qty' => $line['qty']], $lines),
            ],
            ip: $ip,
        );

        return ['tab' => $locked->refresh()->load(Tab::RESOURCE_RELATIONS), 'round_no' => $roundNo];
    }

    /**
     * The stock check across open tabs (see the class doc). Levels are locked in product
     * order, as sales lock them.
     *
     * @param  list<array{product_id: int, qty: int, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     *
     * @throws ValidationException
     */
    private function checkStock(int $branchId, array $lines, Collection $products): void
    {
        $demand = [];

        foreach ($lines as $line) {
            if ($products->get($line['product_id'])->track_stock) {
                $demand[$line['product_id']] = ($demand[$line['product_id']] ?? 0) + $line['qty'];
            }
        }

        if ($demand === []) {
            return;
        }

        ksort($demand);

        $levels = StockLevel::query()
            ->where('branch_id', $branchId)
            ->whereIn('product_id', array_keys($demand))
            ->orderBy('product_id')
            ->lockForUpdate()
            ->get()
            ->keyBy('product_id');

        $onTabs = self::remainingOnOpenTabs($branchId, array_keys($demand));
        $errors = [];

        foreach ($lines as $i => $line) {
            $productId = $line['product_id'];

            if (! array_key_exists($productId, $demand)) {
                continue;
            }

            $onHand = $levels->get($productId)?->wholeQty() ?? 0;
            $already = $onTabs[$productId] ?? 0;

            if ($onHand < $demand[$productId] + $already) {
                $errors["items.{$i}.qty"] = sprintf(
                    CompleteSaleAction::MESSAGE_OUT_OF_STOCK,
                    max(0, $onHand - $already),
                    $products->get($productId)->name,
                );
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * Σ remaining_qty per product on the branch's open tabs.
     *
     * @param  list<int>  $productIds
     * @return array<int, int>
     */
    public static function remainingOnOpenTabs(int $branchId, array $productIds): array
    {
        $grammar = DB::getQueryGrammar();
        $remaining = $grammar->wrap('tab_items.qty').' - '.$grammar->wrap('tab_items.settled_qty').' - '.$grammar->wrap('tab_items.cancelled_qty');

        return DB::table('tab_items')
            ->join('tabs', 'tabs.id', '=', 'tab_items.tab_id')
            ->where('tabs.branch_id', $branchId)
            ->where('tabs.status', Tab::STATUS_OPEN)
            ->whereIn('tab_items.product_id', $productIds)
            ->groupBy('tab_items.product_id')
            ->select('tab_items.product_id')
            ->selectRaw("COALESCE(SUM({$remaining}), 0) AS remaining")
            ->pluck('remaining', 'product_id')
            ->map(fn ($value) => (int) $value)
            ->all();
    }
}
