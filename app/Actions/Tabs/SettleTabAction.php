<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Actions\Recipes\RecipeStock;
use App\Actions\Sales\ApproveDiscount;
use App\Actions\Sales\CompleteSaleAction;
use App\Actions\Sales\RecordOrder;
use App\Exceptions\ConflictException;
use App\Exceptions\PinLockedException;
use App\Http\Requests\Sales\ScPwdRules;
use App\Models\Device;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\User;
use App\Support\BusinessDay;
use App\Support\Money;
use App\Support\Sales\Discount;
use App\Support\Sales\PricedSale;
use App\Support\Sales\SaleCalculator;
use App\Support\Sales\SaleLine;
use App\Support\Sales\SalePricingException;
use App\Support\Sales\ScPwd;
use App\Support\Sales\ServiceCharge;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Settles some or all of a tab's remaining quantities as **one order** (POST /api/v1/tabs/
 * {ulid}/settle, Dine-in Tables & Tabs → D.6 and E). Field validation, the open-shift rule
 * and "a line of this tab" are done by SettleTabRequest. Then, in order:
 *
 * 1. **State:** a tab that isn't open is a `409 "This bill is already closed."`.
 * 2. **Quantities:** each line's quantity (summed when a tab line is sent more than once)
 *    must not exceed its `remaining_qty`, otherwise `409 "This bill changed on another
 *    device. Review it again."`. With `items` omitted, everything remaining is settled (and
 *    nothing remaining is the same `409`).
 * 3. **Pricing** (Core Sale steps 1–9) on the tab lines' snapshots (price, VAT flag), with
 *    the `POST /orders` messages; **no** menu or stock checks. Then the service charge `S`
 *    (ServiceCharge) unless `service_charge` is `false` or the rate is 0;
 *    `total_cents = T + S`.
 * 4. **Checksum** against `total_cents` (±1 accepted and flagged), as for orders.
 * 5. **Payments:** without `split_count`, the `POST /orders` rules (GCash ≤ total, sum ≥
 *    total, the change out of the one cash payment). With `split_count = N`: exactly N
 *    payments in share order (`422` on `payments`: `Add one payment per share (N).`); each
 *    GCash equals its share and each cash payment covers its share, with its own change.
 * 6. **Discount approval** (ApproveDiscount), outside the transaction.
 *
 * Then one transaction: the tab's row is locked and the quantities re-checked (`409`), and
 * the shared RecordOrder path writes the order (numbers, line snapshots, payments, `sale`
 * stock movements without any stock check, recipe depletion and `order.completed`), plus
 * `orders.tab_id`, `table_no` = the table's name, `service_charge_cents`,
 * `service_charge_waived`, `split_count` and each line's `tab_item_id`. The tab lines'
 * `settled_qty` grow; when nothing remains the tab is `closed` and its table freed
 * (`tab.closed`).
 */
class SettleTabAction
{
    public const MESSAGE_ONE_PAYMENT_PER_SHARE = 'Add one payment per share (%d).';

    public const MESSAGE_GCASH_SHARE = 'This GCash payment must be exactly %s.';

    public function __construct(
        private readonly ApproveDiscount $approveDiscount,
        private readonly RecordOrder $recordOrder,
        private readonly RecordAuditLog $recordAuditLog,
        private readonly RecipeStock $recipeStock,
        private readonly LockOpenTab $lockOpenTab,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated SettleTabRequest input
     * @return array{order: Order, tab: Tab}
     *
     * @throws ConflictException
     * @throws ValidationException
     * @throws PinLockedException
     */
    public function execute(Tab $tab, User $cashier, array $input, int $serviceChargeBps, ?Device $device, ?string $ip = null): array
    {
        $ulid = (string) $input['ulid'];

        $recorded = $this->alreadyRecorded($ulid, $cashier);

        if ($recorded !== null) {
            return ['order' => $recorded, 'tab' => $tab->refresh()->load(Tab::RESOURCE_RELATIONS)];
        }

        LockOpenTab::ensureOpen($tab);

        $cashier->loadMissing(['branch', 'role.permissions']);

        $tabItems = TabItem::query()->where('tab_id', $tab->id)->orderBy('round_no')->orderBy('id')->get()->keyBy('id');
        $lines = $this->lines($input, $tabItems);
        $this->checkQuantities($lines, $tabItems);

        $sale = $this->price($lines, $tabItems, Discount::fromArray($input['discount'] ?? null), ScPwd::fromArray($input['sc_pwd'] ?? null));
        $waived = array_key_exists('service_charge', $input) && ! filter_var($input['service_charge'], FILTER_VALIDATE_BOOLEAN);
        $serviceCharge = $waived ? 0 : ServiceCharge::amount($sale->totalCents, $serviceChargeBps);
        $totalCents = $sale->totalCents + $serviceCharge;

        $hasTotalMismatch = $this->checkChecksum((int) $input['client_total_cents'], $totalCents);
        $splitCount = isset($input['split_count']) ? (int) $input['split_count'] : null;
        $payments = $this->settlePayments(array_values($input['payments']), $totalCents, $splitCount);
        $approver = $this->approveDiscount->execute($cashier, $sale, $input['discount_authorization'] ?? null);

        $order = DB::transaction(fn (): Order => $this->record(
            tab: $tab,
            cashier: $cashier,
            ulid: $ulid,
            input: $input,
            lines: $lines,
            sale: $sale,
            serviceCharge: $serviceCharge,
            waived: $waived,
            splitCount: $splitCount,
            payments: $payments,
            approver: $approver,
            hasTotalMismatch: $hasTotalMismatch,
            device: $device,
            ip: $ip,
        ), 3);

        return ['order' => $order, 'tab' => $tab->refresh()->load(Tab::RESOURCE_RELATIONS)];
    }

    /**
     * An order already recorded with this ULID, or null.
     *
     * @throws ConflictException when the ULID belongs to another branch's order
     */
    private function alreadyRecorded(string $ulid, User $cashier): ?Order
    {
        $order = $this->recordOrder->find($ulid);

        if ($order !== null && $order->branch_id !== $cashier->branch_id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        return $order;
    }

    /**
     * The settlement's lines, in the order sent (or every remaining line, by round, when
     * `items` is omitted), shaped as RecordOrder's lines plus their `tab_item_id`.
     *
     * @param  array<string, mixed>  $input
     * @param  Collection<int, TabItem>  $tabItems
     * @return list<array{tab_item_id: int, product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>
     *
     * @throws ConflictException when nothing remains to settle
     */
    private function lines(array $input, Collection $tabItems): array
    {
        if (! array_key_exists('items', $input)) {
            $lines = $tabItems
                ->filter(fn (TabItem $item) => $item->remainingQty() > 0)
                ->map(fn (TabItem $item) => [
                    'tab_item_id' => $item->id,
                    'product_id' => $item->product_id,
                    'qty' => $item->remainingQty(),
                    'discount' => null,
                    'sc_pwd' => false,
                    'notes' => $item->notes,
                ])
                ->values()
                ->all();

            if ($lines === []) {
                throw new ConflictException(LockOpenTab::MESSAGE_CHANGED);
            }

            if (($input['sc_pwd']['mode'] ?? null) === ScPwd::MODE_ITEMS) {
                throw ValidationException::withMessages(['items' => ScPwdRules::MESSAGE_NO_ITEMS_MARKED]);
            }

            return $lines;
        }

        return array_map(function (array $line) use ($tabItems): array {
            /** @var TabItem $item */
            $item = $tabItems->get((int) $line['tab_item_id']);

            return [
                'tab_item_id' => $item->id,
                'product_id' => $item->product_id,
                'qty' => (int) $line['qty'],
                'discount' => Discount::fromArray($line['discount'] ?? null),
                'sc_pwd' => (bool) ($line['sc_pwd'] ?? false),
                'notes' => $item->notes,
            ];
        }, array_values($input['items']));
    }

    /**
     * Check 2 (and its re-check under the lock): the quantities, summed per tab line, never
     * exceed what remains.
     *
     * @param  list<array{tab_item_id: int, qty: int}>  $lines
     * @param  Collection<int, TabItem>  $tabItems
     *
     * @throws ConflictException
     */
    private function checkQuantities(array $lines, Collection $tabItems): void
    {
        $wanted = [];

        foreach ($lines as $line) {
            $wanted[$line['tab_item_id']] = ($wanted[$line['tab_item_id']] ?? 0) + $line['qty'];
        }

        foreach ($wanted as $itemId => $qty) {
            $item = $tabItems->get($itemId);

            if ($item === null || $qty > $item->remainingQty()) {
                throw new ConflictException(LockOpenTab::MESSAGE_CHANGED);
            }
        }
    }

    /**
     * Check 3: prices the lines at their snapshots.
     *
     * @param  list<array{tab_item_id: int, product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, TabItem>  $tabItems
     *
     * @throws ValidationException
     */
    private function price(array $lines, Collection $tabItems, ?Discount $orderDiscount, ?ScPwd $scPwd): PricedSale
    {
        $saleLines = array_map(function (array $line) use ($tabItems): SaleLine {
            $item = $tabItems->get($line['tab_item_id']);

            return new SaleLine($item->unit_price_cents, $line['qty'], $item->is_vatable, $line['discount'], $line['sc_pwd']);
        }, $lines);

        try {
            return SaleCalculator::fromConfig()->price($saleLines, $orderDiscount, $scPwd);
        } catch (SalePricingException $e) {
            throw ValidationException::withMessages(CompleteSaleAction::pricingErrors($e));
        }
    }

    /**
     * Check 4, as for orders. Returns whether the totals differ (by the tolerated centavo).
     *
     * @throws ValidationException
     */
    private function checkChecksum(int $clientTotalCents, int $totalCents): bool
    {
        $difference = abs($clientTotalCents - $totalCents);

        if ($difference > CompleteSaleAction::CHECKSUM_TOLERANCE_CENTS) {
            throw ValidationException::withMessages(['client_total_cents' => CompleteSaleAction::MESSAGE_MENU_CHANGED]);
        }

        return $difference !== 0;
    }

    /**
     * Check 5, then the payments as stored (Σ amount_cents = total_cents).
     *
     * @param  list<array<string, mixed>>  $payments
     * @return list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>
     *
     * @throws ValidationException
     */
    private function settlePayments(array $payments, int $totalCents, ?int $splitCount): array
    {
        if ($splitCount === null) {
            $sum = 0;
            $gcash = 0;

            foreach ($payments as $payment) {
                $sum += (int) $payment['amount_cents'];

                if ($payment['method'] === Payment::METHOD_GCASH) {
                    $gcash += (int) $payment['amount_cents'];
                }
            }

            if ($gcash > $totalCents) {
                throw ValidationException::withMessages(['payments' => CompleteSaleAction::MESSAGE_GCASH_ABOVE_TOTAL]);
            }

            if ($sum < $totalCents) {
                throw ValidationException::withMessages([
                    'payments' => sprintf(CompleteSaleAction::MESSAGE_SHORT, Money::format($totalCents - $sum)),
                ]);
            }

            return $this->recordOrder->settledPayments($payments, $sum - $totalCents);
        }

        if (count($payments) !== $splitCount) {
            throw ValidationException::withMessages(['payments' => sprintf(self::MESSAGE_ONE_PAYMENT_PER_SHARE, $splitCount)]);
        }

        $shares = ServiceCharge::shares($totalCents, $splitCount);
        $errors = [];
        $settled = [];

        foreach ($payments as $i => $payment) {
            $share = $shares[$i];
            $amount = (int) $payment['amount_cents'];

            if ($payment['method'] === Payment::METHOD_GCASH) {
                if ($amount !== $share) {
                    $errors["payments.{$i}.amount_cents"] = sprintf(self::MESSAGE_GCASH_SHARE, Money::format($share));
                }

                $settled[] = ['method' => Payment::METHOD_GCASH, 'amount_cents' => $share, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => $payment['reference_no']];

                continue;
            }

            if ($amount < $share) {
                $errors["payments.{$i}.amount_cents"] = sprintf(CompleteSaleAction::MESSAGE_SHORT, Money::format($share - $amount));
            }

            $settled[] = ['method' => Payment::METHOD_CASH, 'amount_cents' => $share, 'tendered_cents' => $amount, 'change_cents' => $amount - $share, 'reference_no' => null];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $settled;
    }

    /**
     * The quantity re-check under the tab's lock and every write.
     *
     * @param  array<string, mixed>  $input
     * @param  list<array{tab_item_id: int, product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>  $payments
     */
    private function record(
        Tab $tab,
        User $cashier,
        string $ulid,
        array $input,
        array $lines,
        PricedSale $sale,
        int $serviceCharge,
        bool $waived,
        ?int $splitCount,
        array $payments,
        ?User $approver,
        bool $hasTotalMismatch,
        ?Device $device,
        ?string $ip,
    ): Order {
        $locked = $this->lockOpenTab->execute($tab);

        $tabItems = TabItem::query()
            ->where('tab_id', $locked->id)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        $this->checkQuantities($lines, $tabItems);

        $products = Product::withTrashed()
            ->with('category')
            ->whereKey(array_values(array_unique(array_column($lines, 'product_id'))))
            ->get()
            ->keyBy('id');

        // No stock check: the food was served. The levels are locked (created at 0 when
        // missing) and may go below zero, as for an offline sale.
        $trackedIds = $products->filter(fn (Product $product) => $product->track_stock)->keys()->all();
        $levels = StockLevel::lockOrCreateMany($cashier->branch_id, 'product_id', $trackedIds);
        $depletion = $this->recipeStock->prepare($cashier->branch_id, $lines, $products);

        $now = now()->startOfSecond();
        $branch = $cashier->branch;
        $businessDate = BusinessDay::forBranch($branch)->dateOf($now);
        $tableName = DiningTable::withTrashed()->whereKey($locked->table_id)->value('name');

        $order = $this->recordOrder->insert(
            cashier: $cashier,
            ulid: $ulid,
            input: [
                ...$input,
                'customer_id' => array_key_exists('customer_id', $input) ? $input['customer_id'] : $locked->customer_id,
            ],
            lines: $lines,
            products: $products,
            sale: $sale,
            payments: $payments,
            approver: $approver,
            hasTotalMismatch: $hasTotalMismatch,
            numbers: $this->recordOrder->allocateNumbers($branch, $businessDate),
            businessDate: $businessDate,
            placedAt: $now,
            attributes: [
                'device_id' => $device?->id,
                'source' => Order::SOURCE_ONLINE,
                'table_no' => $tableName,
                'tab_id' => $locked->id,
                'service_charge_cents' => $serviceCharge,
                'service_charge_waived' => $waived,
                'split_count' => $splitCount,
                'total_cents' => $sale->totalCents + $serviceCharge,
            ],
            lineAttributes: array_map(function (array $line) use ($tabItems): array {
                $item = $tabItems->get($line['tab_item_id']);

                return [
                    'tab_item_id' => $item->id,
                    'product_name' => $item->product_name,
                    'category_id' => $item->category_id,
                    'category_name' => $item->category_name,
                    'sku' => $item->sku,
                ];
            }, $lines),
        );

        $this->recordOrder->recordStockMovements($order, $lines, $products, $levels, $cashier, $now);
        $this->recipeStock->deplete($depletion, $order, $order->items, $cashier, $now);

        $this->recordAuditLog->execute(
            action: 'order.completed',
            actor: $cashier,
            subject: $order,
            changes: [
                'invoice_no' => $order->invoice_no,
                'total_cents' => $order->total_cents,
                'authorized_by' => $approver?->id,
                'sc_pwd' => RecordOrder::scPwdAudit($sale),
            ],
            ip: $ip,
        );

        foreach ($lines as $line) {
            $item = $tabItems->get($line['tab_item_id']);
            $item->forceFill(['settled_qty' => $item->settled_qty + $line['qty']])->save();
        }

        if ($tabItems->every(fn (TabItem $item) => $item->remainingQty() === 0)) {
            CloseTabAction::close($locked, $cashier, Tab::STATUS_CLOSED);

            $this->recordAuditLog->execute(
                action: 'tab.closed',
                actor: $cashier,
                subject: $locked,
                changes: ['status' => Tab::STATUS_CLOSED],
                ip: $ip,
            );
        } else {
            $locked->touch();
        }

        return $order->load(RecordOrder::RESOURCE_RELATIONS);
    }
}
