<?php

namespace App\Actions\Sync;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Recipes\RecipeStock;
use App\Actions\Sales\ApproveDiscount;
use App\Actions\Sales\CompleteSaleAction;
use App\Actions\Sales\RecordOrder;
use App\Http\Requests\Sync\OfflineOrderRules;
use App\Models\Branch;
use App\Models\Device;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Shift;
use App\Models\StockLevel;
use App\Models\User;
use App\Support\BusinessDay;
use App\Support\Sales\Discount;
use App\Support\Sales\PricedSale;
use App\Support\Sales\SaleCalculator;
use App\Support\Sales\SaleLine;
use App\Support\Sales\SalePricingException;
use App\Support\Sales\ScPwd;
use App\Support\Ulid;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Throwable;

/**
 * Ingests one offline sale from POST /api/v1/sync/orders (Phase 5, PROJECT_MEMORY §8).
 * The sale already happened at the counter, so it is **never rejected** for price,
 * stock, checksum or payment: it is stored and flagged for review instead.
 *
 * In order:
 * 1. **Duplicate:** an order with this `ulid` exists in the branch (a retry, or a sale
 *    committed online before a timeout) → `duplicate` with the stored order.
 * 2. **Rejected** (nothing stored), only for orders that can never be stored: field
 *    validation (the first message); a product that never existed (soft-deleted is fine);
 *    a `cashier_id` that isn't an active user of the branch with `sale.create`; a
 *    `customer_id` that never existed; an `order_no` already used on this device by
 *    another ulid. Provisionally (Q-008): a sale that can't be priced, a ulid owned by
 *    another branch, and an unexpected server error.
 * 3. **Accepted**, in its own transaction: priced at the **snapshot** unit prices;
 *    snapshots of name, category and cost from the product (deleted ones included);
 *    stock movements applied even below zero; `invoice_no` allocated now, `queue_no` and
 *    `business_date` from the business day of `placed_at`; `placed_at` as given (a future
 *    time clamped to now); `device_id` from the token, `user_id` = `cashier_id`,
 *    `source: offline`, `synced_at` = now; the `order.completed` audit entry with
 *    `source: offline`; and the review flags, in their fixed order (Phase 6 adds
 *    `shift_closed`; the order keeps its `shift_ulid` whatever the shift's state).
 *    SC/PWD is priced like online and never counts toward `discount_over_limit`, which
 *    compares the regular discounts only.
 */
class IngestOfflineOrderAction
{
    public const MESSAGE_PRODUCT_MISSING = "Product %d doesn't exist.";

    public const MESSAGE_CUSTOMER_MISSING = "Customer %d doesn't exist.";

    public const MESSAGE_CASHIER_INVALID = "User %d can't record sales in this branch.";

    public const MESSAGE_ORDER_NO_USED = 'The number %s was already used on this tablet for another sale.';

    public const MESSAGE_OTHER_BRANCH = 'This sale was already recorded in another branch.';

    public const MESSAGE_SERVER_ERROR = "The server couldn't record this sale. Try again.";

    /**
     * A `placed_at` further ahead of the server's clock than this is flagged `clock_skew`.
     */
    public const CLOCK_SKEW_TOLERANCE_SECONDS = 300;

    /**
     * The review flags, in the order they are stored.
     */
    public const REVIEW_REASON_ORDER = [
        Order::REVIEW_PRICE_CHANGED,
        Order::REVIEW_OVERSOLD,
        Order::REVIEW_TOTAL_MISMATCH,
        Order::REVIEW_PAYMENT_SHORT,
        Order::REVIEW_DISCOUNT_OVER_LIMIT,
        Order::REVIEW_CLOCK_SKEW,
        Order::REVIEW_SHIFT_CLOSED,
    ];

    public function __construct(
        private readonly RecordOrder $recordOrder,
        private readonly RecordAuditLog $recordAuditLog,
        private readonly RecipeStock $recipeStock,
    ) {}

    /**
     * @param  User  $caller  The token's user (their branch is the order's branch)
     * @param  Device  $device  The device the caller's token is bound to
     * @param  mixed  $submitted  One element of the request's `orders`
     * @param  OfflineOrderBatch|null  $batch  The batch's shared lookups (a batch of this order alone when null)
     */
    public function execute(User $caller, Device $device, mixed $submitted, ?string $ip = null, ?OfflineOrderBatch $batch = null): OfflineOrderResult
    {
        $ulid = is_array($submitted) && is_string($submitted['ulid'] ?? null) ? $submitted['ulid'] : null;
        $batch ??= OfflineOrderBatch::for([$submitted]);

        try {
            return $this->ingest($caller, $device, $submitted, $ulid, $ip, $batch);
        } catch (Throwable $e) {
            // One order's failure never affects the rest of the batch (Q-008, item 4).
            report($e);

            return OfflineOrderResult::rejected($ulid, self::MESSAGE_SERVER_ERROR);
        }
    }

    private function ingest(User $caller, Device $device, mixed $submitted, ?string $ulid, ?string $ip, OfflineOrderBatch $batch): OfflineOrderResult
    {
        // 1. Duplicate
        if ($ulid !== null && Ulid::isValid($ulid)) {
            $known = $this->known($ulid, $caller);

            if ($known !== null) {
                return $known;
            }
        }

        // 2. Rejected: field validation
        $order = OfflineOrderRules::prepare($submitted);
        $validator = Validator::make(
            $order,
            OfflineOrderRules::rules($order),
            OfflineOrderRules::messages(),
            OfflineOrderRules::attributes(),
        );

        if ($validator->fails()) {
            return OfflineOrderResult::rejected($ulid, (string) $validator->errors()->first());
        }

        /** @var array<string, mixed> $input */
        $input = $validator->validated();
        $ulid = (string) $input['ulid'];
        $lines = $this->recordOrder->lines($input['items']);
        $unitPrices = array_map(fn (array $item) => (int) $item['unit_price_cents'], array_values($input['items']));

        // 2. Rejected: the references
        $products = $batch->products(array_column($lines, 'product_id'));

        foreach ($lines as $line) {
            if (! $products->has($line['product_id'])) {
                return OfflineOrderResult::rejected($ulid, sprintf(self::MESSAGE_PRODUCT_MISSING, $line['product_id']));
            }
        }

        $cashier = $batch->cashier((int) $input['cashier_id'], $caller);

        if ($cashier === null) {
            return OfflineOrderResult::rejected($ulid, sprintf(self::MESSAGE_CASHIER_INVALID, (int) $input['cashier_id']));
        }

        $customerId = isset($input['customer_id']) ? (int) $input['customer_id'] : null;

        if ($customerId !== null && ! $batch->customerExists($customerId)) {
            return OfflineOrderResult::rejected($ulid, sprintf(self::MESSAGE_CUSTOMER_MISSING, $customerId));
        }

        if ($this->orderNoUsed($device, (string) $input['order_no'])) {
            return OfflineOrderResult::rejected($ulid, sprintf(self::MESSAGE_ORDER_NO_USED, $input['order_no']));
        }

        // Pricing at the snapshot prices. A sale that can't be priced at all is rejected (Q-008, item 1).
        try {
            $sale = SaleCalculator::fromConfig()->price(
                array_map(fn (array $line, int $unitPrice) => new SaleLine(
                    $unitPrice,
                    $line['qty'],
                    $products->get($line['product_id'])->is_vatable,
                    $line['discount'],
                    $line['sc_pwd'],
                ), $lines, $unitPrices),
                Discount::fromArray($input['discount'] ?? null),
                ScPwd::fromArray($input['sc_pwd'] ?? null),
            );
        } catch (SalePricingException $e) {
            return OfflineOrderResult::rejected($ulid, array_values(CompleteSaleAction::pricingErrors($e))[0]);
        }

        // 3. Accepted
        try {
            $stored = DB::transaction(fn (): Order => $this->record(
                caller: $caller,
                cashier: $cashier,
                device: $device,
                ulid: $ulid,
                input: [...$input, 'customer_id' => $customerId],
                lines: $lines,
                unitPrices: $unitPrices,
                products: $products,
                sale: $sale,
                ip: $ip,
                batch: $batch,
            ), 3);
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent sync stored the same sale, or used the number, first.
            $known = $this->known($ulid, $caller);

            if ($known !== null) {
                return $known;
            }

            if ($this->orderNoUsed($device, (string) $input['order_no'])) {
                return OfflineOrderResult::rejected($ulid, sprintf(self::MESSAGE_ORDER_NO_USED, $input['order_no']));
            }

            throw $e;
        }

        return OfflineOrderResult::accepted($stored);
    }

    /**
     * `duplicate` when the branch already has an order with this ULID; `rejected` when
     * another branch has it (Q-008, item 3); otherwise null.
     */
    private function known(string $ulid, User $caller): ?OfflineOrderResult
    {
        $order = $this->recordOrder->find($ulid);

        if ($order === null) {
            return null;
        }

        return $order->branch_id === (int) $caller->branch_id
            ? OfflineOrderResult::duplicate($order)
            : OfflineOrderResult::rejected($ulid, self::MESSAGE_OTHER_BRANCH);
    }

    private function orderNoUsed(Device $device, string $orderNo): bool
    {
        return Order::query()->where('device_id', $device->id)->where('order_no', $orderNo)->exists();
    }

    /**
     * The writes, inside the transaction. Levels are locked (created at 0 when missing)
     * before the sequences, in product order, as the online path does.
     *
     * @param  array<string, mixed>  $input
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  list<int>  $unitPrices  The snapshot unit prices, by line
     * @param  Collection<int, Product>  $products
     */
    private function record(
        User $caller,
        User $cashier,
        Device $device,
        string $ulid,
        array $input,
        array $lines,
        array $unitPrices,
        Collection $products,
        PricedSale $sale,
        ?string $ip,
        OfflineOrderBatch $batch,
    ): Order {
        /** @var Branch $branch */
        $branch = $caller->branch()->withTrashed()->firstOrFail();
        $now = CarbonImmutable::now()->startOfSecond();

        $demand = $this->recordOrder->stockDemand($lines, $products);
        $levels = collect();
        $oversold = false;

        foreach ($demand as $productId => $qty) {
            $level = StockLevel::lockOrCreate($branch->id, $productId);
            $levels->put($productId, $level);
            $oversold = $oversold || $level->wholeQty() - $qty < 0;
        }

        // Round B: the **current** recipes' components, their levels locked before the sequences.
        // Depletion never blocks and never flags the sale.
        $depletion = $this->recipeStock->prepare($branch->id, $lines, $products);

        $placedAt = CarbonImmutable::parse((string) $input['placed_at'])->utc()->startOfSecond();
        $clockSkew = $placedAt->greaterThan($now->addSeconds(self::CLOCK_SKEW_TOLERANCE_SECONDS));

        if ($placedAt->greaterThan($now)) {
            $placedAt = $now;
        }

        $businessDate = BusinessDay::forBranch($branch)->dateOf($placedAt);

        $totalDifference = abs((int) $input['client_total_cents'] - $sale->totalCents);
        [$payments, $paymentShort] = $this->payments($input['payments'], $sale->totalCents);

        $reasons = $this->reasons([
            Order::REVIEW_PRICE_CHANGED => $this->priceChanged($lines, $unitPrices, $products),
            Order::REVIEW_OVERSOLD => $oversold,
            Order::REVIEW_TOTAL_MISMATCH => $totalDifference > CompleteSaleAction::CHECKSUM_TOLERANCE_CENTS,
            Order::REVIEW_PAYMENT_SHORT => $paymentShort,
            Order::REVIEW_DISCOUNT_OVER_LIMIT => ApproveDiscount::isNeeded($cashier, $sale->subtotalCents, $sale->regularDiscountCents()),
            Order::REVIEW_CLOCK_SKEW => $clockSkew,
            Order::REVIEW_SHIFT_CLOSED => $this->shiftClosed($batch->shift((string) $input['shift_ulid'], $branch->id), $placedAt),
        ]);

        $order = $this->recordOrder->insert(
            cashier: $cashier,
            ulid: $ulid,
            input: $input,
            lines: $lines,
            products: $products,
            sale: $sale,
            payments: $payments,
            approver: null,
            hasTotalMismatch: $totalDifference !== 0,
            numbers: $this->recordOrder->allocateNumbers($branch, $businessDate),
            businessDate: $businessDate,
            placedAt: $placedAt,
            attributes: [
                'device_id' => $device->id,
                'order_no' => (string) $input['order_no'],
                'source' => Order::SOURCE_OFFLINE,
                'needs_review' => $reasons !== [],
                'review_reasons' => $reasons,
                'synced_at' => $now,
            ],
        );

        $this->recordOrder->recordStockMovements($order, $lines, $products, $levels, $cashier, $placedAt);
        $this->recipeStock->deplete($depletion, $order, $order->items, $cashier, $placedAt);

        $this->recordAuditLog->execute(
            action: 'order.completed',
            actor: $cashier,
            subject: $order,
            changes: [
                'invoice_no' => $order->invoice_no,
                'total_cents' => $order->total_cents,
                'authorized_by' => null,
                'source' => Order::SOURCE_OFFLINE,
                'sc_pwd' => RecordOrder::scPwdAudit($sale),
            ],
            ip: $ip,
        );

        return $order->load(RecordOrder::RESOURCE_RELATIONS);
    }

    /**
     * The payments as stored, and whether they are short. With enough payment and GCash
     * within the total, the Phase 3 rules apply (the change comes out of cash). Otherwise
     * they are stored **as tendered**, with change 0: short payments per the contract, and
     * GCash above the total provisionally (Q-008, item 2).
     *
     * @param  list<array<string, mixed>>  $payments
     * @return array{0: list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>, 1: bool}
     */
    private function payments(array $payments, int $totalCents): array
    {
        $sum = 0;
        $gcash = 0;

        foreach ($payments as $payment) {
            $sum += (int) $payment['amount_cents'];

            if ($payment['method'] === Payment::METHOD_GCASH) {
                $gcash += (int) $payment['amount_cents'];
            }
        }

        $short = $sum < $totalCents;

        if (! $short && $gcash <= $totalCents) {
            return [$this->recordOrder->settledPayments($payments, $sum - $totalCents), false];
        }

        return [$this->recordOrder->settledPayments($payments, 0), $short];
    }

    /**
     * `price_changed`: a line's snapshot price differs from the product's current price, or
     * the product is deleted or unavailable, or its category is deleted or inactive.
     *
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  list<int>  $unitPrices
     * @param  Collection<int, Product>  $products
     */
    private function priceChanged(array $lines, array $unitPrices, Collection $products): bool
    {
        foreach ($lines as $i => $line) {
            $product = $products->get($line['product_id']);
            $category = $product->category;

            if ($unitPrices[$i] !== $product->price_cents
                || $product->trashed()
                || ! $product->is_available
                || $category === null
                || $category->trashed()
                || ! $category->is_active) {
                return true;
            }
        }

        return false;
    }

    /**
     * `shift_closed` (Phase 6): the order's shift is known to the branch and was closed
     * before the order's (stored, clamped) `placed_at`. The order itself is never rejected.
     */
    private function shiftClosed(?Shift $shift, CarbonImmutable $placedAt): bool
    {
        return $shift?->closed_at !== null && $shift->closed_at->lessThan($placedAt);
    }

    /**
     * The flags that apply, in their fixed order.
     *
     * @param  array<string, bool>  $flags
     * @return list<string>
     */
    private function reasons(array $flags): array
    {
        return array_values(array_filter(self::REVIEW_REASON_ORDER, fn (string $reason) => $flags[$reason]));
    }
}
