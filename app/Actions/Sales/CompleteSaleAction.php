<?php

namespace App\Actions\Sales;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Actions\Recipes\RecipeStock;
use App\Exceptions\ConflictException;
use App\Exceptions\PinLockedException;
use App\Models\Device;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\User;
use App\Support\BusinessDay;
use App\Support\Money;
use App\Support\Sales\Discount;
use App\Support\Sales\PricedSale;
use App\Support\Sales\SaleCalculator;
use App\Support\Sales\SaleLine;
use App\Support\Sales\SalePricingException;
use App\Support\Sales\ScPwd;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Collection as SupportCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Completes an online sale (POST /api/v1/orders). The server prices everything itself;
 * the client's total is only a checksum. Checks run in the contract's order and the
 * first failure wins (field validation and `sale.create` are done by StoreOrderRequest):
 *
 * 2. Menu: each product exists, is not deleted, is in an active non-deleted category,
 *    and is available.
 * 3. Pricing (SaleCalculator): no discount above its base; the size limit.
 * 4. Checksum: `|client_total_cents − total_cents| ≤ 1` (1 is accepted and flagged).
 * 5. Payments: GCash ≤ total, then the full sum ≥ total.
 * 6. Discount approval by a manager's PIN, when needed (ApproveDiscount).
 * 7. Stock, inside the transaction under `lockForUpdate`: the demand of each `track_stock`
 *    product, summed over its lines, must not exceed the quantity on hand (no row = 0).
 *
 * Then, in the same transaction (PROJECT_MEMORY §6.6), through the shared RecordOrder:
 * `invoice_no` and the business day's `queue_no` from the row-locked sequences, the order
 * with its line snapshots (the product's `category_id` included since Phase 4, for printer
 * routing) and payments, one `sale` movement per `track_stock` product with its level
 * updated, and the `order.completed` audit entry. Since Phase 5 the order also records
 * the token's device (`device_id`, or null) and `source: online`. Since Round B
 * (Ingredients, Recipes & Purchasing → J) the `recipe` lines deplete their components
 * (RecipeStock), never checked and never blocking. Any failure rolls everything back.
 *
 * The PIN check (6) runs before the transaction on purpose: a wrong PIN must stay counted
 * even though the request fails.
 */
class CompleteSaleAction
{
    public const MESSAGE_NOT_ON_MENU = 'This product is no longer on the menu.';

    public const MESSAGE_UNAVAILABLE = '"%s" is unavailable.';

    public const MESSAGE_DISCOUNT_ABOVE_BASE = "The discount can't be more than %s.";

    public const MESSAGE_TOO_LARGE = 'This sale is too large.';

    public const MESSAGE_MENU_CHANGED = 'The menu has changed since your last sync. Review the new total.';

    public const MESSAGE_GCASH_ABOVE_TOTAL = "GCash can't be more than the total.";

    public const MESSAGE_SHORT = 'The payment is short by %s.';

    public const MESSAGE_OUT_OF_STOCK = 'Only %d "%s" left in stock.';

    /**
     * A client total this far from the server's is accepted (rounding) and flagged.
     */
    public const CHECKSUM_TOLERANCE_CENTS = 1;

    /**
     * Relations the Order resource reads.
     */
    public const RESOURCE_RELATIONS = RecordOrder::RESOURCE_RELATIONS;

    public function __construct(
        private readonly ApproveDiscount $approveDiscount,
        private readonly RecordOrder $recordOrder,
        private readonly RecordAuditLog $recordAuditLog,
        private readonly RecipeStock $recipeStock,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated StoreOrderRequest input
     * @param  Device|null  $device  The device the caller's token is bound to (Phase 5)
     *
     * @throws ValidationException 422 (checks 2–7)
     * @throws PinLockedException 429 (the approver's PIN is locked)
     * @throws ConflictException 409 (the ULID belongs to another branch's order)
     */
    public function execute(User $cashier, array $input, ?string $ip = null, ?Device $device = null): Order
    {
        $ulid = (string) $input['ulid'];

        // Normally a retry never gets here: the idempotency middleware replays the stored
        // response. This covers a key released after the sale was already committed (or a
        // sale already synced from the device's offline queue).
        $recorded = $this->alreadyRecorded($ulid, $cashier);

        if ($recorded !== null) {
            return $recorded;
        }

        $cashier->loadMissing(['branch', 'role.permissions']);

        $lines = $this->recordOrder->lines($input['items']);
        $products = $this->checkMenu($lines);
        $sale = $this->price($lines, $products, Discount::fromArray($input['discount'] ?? null), ScPwd::fromArray($input['sc_pwd'] ?? null));
        $hasTotalMismatch = $this->checkChecksum((int) $input['client_total_cents'], $sale->totalCents);
        $payments = $this->settlePayments($input['payments'], $sale->totalCents);
        $approver = $this->approveDiscount->execute($cashier, $sale, $input['discount_authorization'] ?? null);

        return DB::transaction(fn (): Order => $this->record(
            cashier: $cashier,
            ulid: $ulid,
            input: $input,
            lines: $lines,
            products: $products,
            sale: $sale,
            payments: $payments,
            approver: $approver,
            hasTotalMismatch: $hasTotalMismatch,
            device: $device,
            ip: $ip,
        ), 3);
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
     * Check 2. Returns the lines' products keyed by id.
     *
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @return Collection<int, Product>
     *
     * @throws ValidationException
     */
    public function checkMenu(array $lines): Collection
    {
        $products = Product::withTrashed()
            ->with('category')
            ->whereKey(array_values(array_unique(array_column($lines, 'product_id'))))
            ->get()
            ->keyBy('id');

        $errors = [];

        foreach ($lines as $i => $line) {
            $product = $products->get($line['product_id']);
            $category = $product?->category;

            if ($product === null || $product->trashed() || $category === null || $category->trashed() || ! $category->is_active) {
                $errors["items.{$i}.product_id"] = self::MESSAGE_NOT_ON_MENU;
            } elseif (! $product->is_available) {
                $errors["items.{$i}.product_id"] = sprintf(self::MESSAGE_UNAVAILABLE, $product->name);
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $products;
    }

    /**
     * Check 3: prices the sale at the server's current prices.
     *
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     *
     * @throws ValidationException
     */
    private function price(array $lines, Collection $products, ?Discount $orderDiscount, ?ScPwd $scPwd): PricedSale
    {
        $saleLines = array_map(function (array $line) use ($products): SaleLine {
            $product = $products->get($line['product_id']);

            return new SaleLine($product->price_cents, $line['qty'], $product->is_vatable, $line['discount'], $line['sc_pwd']);
        }, $lines);

        try {
            return SaleCalculator::fromConfig()->price($saleLines, $orderDiscount, $scPwd);
        } catch (SalePricingException $e) {
            throw ValidationException::withMessages(self::pricingErrors($e));
        }
    }

    /**
     * The contract's messages for a sale that cannot be priced: each discount above its
     * base (`items.{i}.discount.value`, `discount.value`) and the size limit (`items`).
     *
     * @return array<string, string>
     */
    public static function pricingErrors(SalePricingException $e): array
    {
        $errors = [];

        foreach ($e->lineDiscountBases as $i => $base) {
            $errors["items.{$i}.discount.value"] = sprintf(self::MESSAGE_DISCOUNT_ABOVE_BASE, Money::format($base));
        }

        if ($e->orderDiscountBase !== null) {
            $errors['discount.value'] = sprintf(self::MESSAGE_DISCOUNT_ABOVE_BASE, Money::format($e->orderDiscountBase));
        }

        if ($e->tooLarge) {
            $errors['items'] = self::MESSAGE_TOO_LARGE;
        }

        return $errors;
    }

    /**
     * Check 4. Returns whether the totals differ (by the tolerated centavo).
     *
     * @throws ValidationException
     */
    private function checkChecksum(int $clientTotalCents, int $totalCents): bool
    {
        $difference = abs($clientTotalCents - $totalCents);

        if ($difference > self::CHECKSUM_TOLERANCE_CENTS) {
            throw ValidationException::withMessages(['client_total_cents' => self::MESSAGE_MENU_CHANGED]);
        }

        return $difference !== 0;
    }

    /**
     * Check 5, then the payments as stored: the change (sum − total) comes out of the
     * cash payment, so Σ amount_cents = total_cents.
     *
     * @param  list<array<string, mixed>>  $payments
     * @return list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>
     *
     * @throws ValidationException
     */
    private function settlePayments(array $payments, int $totalCents): array
    {
        $sum = 0;
        $gcash = 0;

        foreach ($payments as $payment) {
            $sum += (int) $payment['amount_cents'];

            if ($payment['method'] === Payment::METHOD_GCASH) {
                $gcash += (int) $payment['amount_cents'];
            }
        }

        if ($gcash > $totalCents) {
            throw ValidationException::withMessages(['payments' => self::MESSAGE_GCASH_ABOVE_TOTAL]);
        }

        if ($sum < $totalCents) {
            throw ValidationException::withMessages([
                'payments' => sprintf(self::MESSAGE_SHORT, Money::format($totalCents - $sum)),
            ]);
        }

        // GCash never exceeds the total, so any change is covered by the (single) cash payment.
        return $this->recordOrder->settledPayments($payments, $sum - $totalCents);
    }

    /**
     * Check 7 and every write, inside the transaction.
     *
     * @param  array<string, mixed>  $input
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     * @param  list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>  $payments
     *
     * @throws ValidationException
     */
    private function record(
        User $cashier,
        string $ulid,
        array $input,
        array $lines,
        Collection $products,
        PricedSale $sale,
        array $payments,
        ?User $approver,
        bool $hasTotalMismatch,
        ?Device $device,
        ?string $ip,
    ): Order {
        $levels = $this->checkStock($cashier->branch_id, $lines, $products);

        // Round B: the recipes' components are read and their levels locked before the
        // sequences (never checked: depletion never blocks a sale).
        $depletion = $this->recipeStock->prepare($cashier->branch_id, $lines, $products);

        $now = now()->startOfSecond();
        $branch = $cashier->branch;
        $businessDate = BusinessDay::forBranch($branch)->dateOf($now);

        $order = $this->recordOrder->insert(
            cashier: $cashier,
            ulid: $ulid,
            input: $input,
            lines: $lines,
            products: $products,
            sale: $sale,
            payments: $payments,
            approver: $approver,
            hasTotalMismatch: $hasTotalMismatch,
            numbers: $this->recordOrder->allocateNumbers($branch, $businessDate),
            businessDate: $businessDate,
            placedAt: $now,
            attributes: ['device_id' => $device?->id, 'source' => Order::SOURCE_ONLINE],
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

        return $order->load(self::RESOURCE_RELATIONS);
    }

    /**
     * Check 7: locks the branch's stock levels of the `track_stock` products (in product
     * order, so concurrent sales cannot deadlock) and compares each product's demand,
     * summed over its lines, with the quantity on hand (a missing level is 0). Every line
     * of a short product gets the message.
     *
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     * @return SupportCollection<int, StockLevel> The locked levels keyed by product id
     *
     * @throws ValidationException
     */
    private function checkStock(int $branchId, array $lines, Collection $products): SupportCollection
    {
        $demand = $this->recordOrder->stockDemand($lines, $products);

        if ($demand === []) {
            return collect();
        }

        $levels = StockLevel::query()
            ->where('branch_id', $branchId)
            ->whereIn('product_id', array_keys($demand))
            ->orderBy('product_id')
            ->lockForUpdate()
            ->get()
            ->keyBy('product_id');

        $errors = [];

        foreach ($lines as $i => $line) {
            $productId = $line['product_id'];

            if (! array_key_exists($productId, $demand)) {
                continue;
            }

            $onHand = $levels->get($productId)?->wholeQty() ?? 0;

            if ($demand[$productId] > $onHand) {
                $errors["items.{$i}.qty"] = sprintf(self::MESSAGE_OUT_OF_STOCK, max(0, $onHand), $products->get($productId)->name);
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $levels;
    }
}
