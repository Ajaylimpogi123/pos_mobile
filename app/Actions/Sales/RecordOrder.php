<?php

namespace App\Actions\Sales;

use App\Actions\Inventory\RecordStockMovementAction;
use App\Models\Branch;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Sales\Discount;
use App\Support\Sales\PricedSale;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Collection as SupportCollection;

/**
 * The parts of recording a sale shared by the online path (App\Actions\Sales\
 * CompleteSaleAction, POST /orders) and the offline ingest (App\Actions\Sync\
 * IngestOfflineOrderAction, POST /sync/orders, Phase 5): parsing the lines, the stock
 * demand, the number allocation, and the writes of the order, its line snapshots, its
 * payments and its `sale` stock movements.
 *
 * The allocation and the writes must run inside the caller's transaction; the caller
 * decides every check (menu, pricing, stock, payments) and every flag.
 *
 * SC/PWD: the order stores the request (`sc_pwd_mode`, `sc_pwd_diners`,
 * `sc_pwd_vat_exempt`, `sc_pwd_persons`) and `R` / `S`; each line stores `is_sc_pwd`,
 * `E_i`, `R_i` and `S_i`.
 */
class RecordOrder
{
    /**
     * Relations the Order resource reads (Phase 7 adds the void's users and the refunds with
     * their users, lines and payments).
     */
    public const RESOURCE_RELATIONS = [
        'cashier', 'approver', 'reviewer', 'customer', 'items', 'payments',
        'voider', 'voidAuthorizer',
        'refunds.refunder', 'refunds.authorizer', 'refunds.items.orderItem', 'refunds.payments',
    ];

    public function __construct(
        private readonly AllocateSequenceValue $allocateSequenceValue,
        private readonly RecordStockMovementAction $recordStockMovement,
    ) {}

    /**
     * The order recorded with this ULID (in any branch), loaded for the resource, or null.
     */
    public function find(string $ulid): ?Order
    {
        return Order::query()->where('ulid', $ulid)->first()?->load(self::RESOURCE_RELATIONS);
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>
     */
    public function lines(array $items): array
    {
        return array_map(fn (array $item) => [
            'product_id' => (int) $item['product_id'],
            'qty' => (int) $item['qty'],
            'discount' => Discount::fromArray($item['discount'] ?? null),
            // SC/PWD `items` mode: the line is marked for the senior citizen or PWD.
            'sc_pwd' => (bool) ($item['sc_pwd'] ?? false),
            'notes' => $item['notes'] ?? null,
        ], array_values($items));
    }

    /**
     * The quantity sold of each `track_stock` product, summed over its lines, by product id
     * (ascending, the order in which levels are locked).
     *
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     * @return array<int, int>
     */
    public function stockDemand(array $lines, Collection $products): array
    {
        $demand = [];

        foreach ($lines as $line) {
            if ($products->get($line['product_id'])->track_stock) {
                $demand[$line['product_id']] = ($demand[$line['product_id']] ?? 0) + $line['qty'];
            }
        }

        ksort($demand);

        return $demand;
    }

    /**
     * `invoice_no` (per branch, never reset) and the business day's `queue_no`, from the
     * row-locked sequences. Inside the caller's transaction.
     *
     * @return array{invoice_no: string, queue_no: int}
     */
    public function allocateNumbers(Branch $branch, string $businessDate): array
    {
        $invoiceNumber = $this->allocateSequenceValue->execute($branch->id, AllocateSequenceValue::INVOICE);
        $queueNumber = $this->allocateSequenceValue->execute($branch->id, AllocateSequenceValue::QUEUE, $businessDate);

        return [
            'invoice_no' => sprintf('INV-%s-%08d', $branch->code, $invoiceNumber),
            'queue_no' => $queueNumber,
        ];
    }

    /**
     * The payments as stored under the Phase 3 rules: the change comes out of the (single)
     * cash payment, so Σ amount_cents = total_cents. The caller has checked that GCash
     * does not exceed the total and that the sum covers it.
     *
     * @param  list<array<string, mixed>>  $payments  Validated payments as sent
     * @return list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>
     */
    public function settledPayments(array $payments, int $changeCents): array
    {
        return array_map(function (array $payment) use ($changeCents): array {
            $amount = (int) $payment['amount_cents'];

            return $payment['method'] === Payment::METHOD_CASH
                ? ['method' => Payment::METHOD_CASH, 'amount_cents' => $amount - $changeCents, 'tendered_cents' => $amount, 'change_cents' => $changeCents, 'reference_no' => null]
                : ['method' => Payment::METHOD_GCASH, 'amount_cents' => $amount, 'tendered_cents' => null, 'change_cents' => 0, 'reference_no' => $payment['reference_no']];
        }, array_values($payments));
    }

    /**
     * Inserts the order, its lines (with the product snapshots: name, category, sku, cost,
     * and the product's `category_id` for printer routing) and its payments, in the order
     * sent. `$attributes` adds or overrides order columns (e.g. `device_id`, `source`,
     * the Phase 5 offline fields).
     *
     * @param  array<string, mixed>  $input  The validated order body
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products  The lines' products keyed by id (soft-deleted included)
     * @param  list<array{method: string, amount_cents: int, tendered_cents: int|null, change_cents: int, reference_no: string|null}>  $payments
     * @param  array{invoice_no: string, queue_no: int}  $numbers
     * @param  array<string, mixed>  $attributes
     */
    public function insert(
        User $cashier,
        string $ulid,
        array $input,
        array $lines,
        Collection $products,
        PricedSale $sale,
        array $payments,
        ?User $approver,
        bool $hasTotalMismatch,
        array $numbers,
        string $businessDate,
        CarbonInterface $placedAt,
        array $attributes = [],
    ): Order {
        $orderDiscount = $sale->orderDiscount;

        $tendered = 0;
        $change = 0;

        foreach ($payments as $payment) {
            $tendered += $payment['tendered_cents'] ?? $payment['amount_cents'];
            $change += $payment['change_cents'];
        }

        $order = new Order;
        $order->forceFill([
            'ulid' => $ulid,
            'branch_id' => $cashier->branch_id,
            'user_id' => $cashier->id,
            'shift_ulid' => $input['shift_ulid'] ?? null,
            'customer_id' => $input['customer_id'] ?? null,
            'authorized_by' => $approver?->id,
            'invoice_no' => $numbers['invoice_no'],
            'queue_no' => $numbers['queue_no'],
            // Phase 6: Σ qty of the lines, and each line's and payment's branch and business
            // day, so the sales reports never join a year of orders row by row.
            'items_qty' => array_sum(array_map(fn ($line) => $line->qty, $sale->lines)),
            'table_no' => $input['table_no'] ?? null,
            'business_date' => $businessDate,
            'status' => Order::STATUS_COMPLETED,
            'subtotal_cents' => $sale->subtotalCents,
            'line_discounts_cents' => $sale->lineDiscountsCents,
            'discount_type' => $orderDiscount?->type ?? Order::NO_DISCOUNT,
            'discount_kind' => $orderDiscount?->kind,
            'discount_value' => $orderDiscount?->value,
            'order_discount_cents' => $sale->orderDiscountCents,
            // SC/PWD: the request as sent (ID numbers included) and `R` / `S`.
            'sc_pwd_mode' => $sale->scPwd?->mode,
            'sc_pwd_diners' => $sale->scPwd?->diners,
            'sc_pwd_vat_exempt' => $sale->scPwd?->vatExempt ?? false,
            'sc_pwd_persons' => $sale->scPwd?->persons,
            'sc_pwd_vat_relief_cents' => $sale->scPwdVatReliefCents,
            'sc_pwd_discount_cents' => $sale->scPwdDiscountCents,
            'discount_cents' => $sale->discountCents,
            'total_cents' => $sale->totalCents,
            'vatable_sales_cents' => $sale->vatableSalesCents,
            'vat_amount_cents' => $sale->vatAmountCents,
            'vat_exempt_sales_cents' => $sale->vatExemptSalesCents,
            'tendered_cents' => $tendered,
            'change_cents' => $change,
            'client_total_cents' => (int) $input['client_total_cents'],
            'has_total_mismatch' => $hasTotalMismatch,
            'notes' => $input['notes'] ?? null,
            'placed_at' => $placedAt,
            ...$attributes,
        ])->save();

        $items = [];

        foreach ($sale->lines as $i => $pricedLine) {
            $line = $lines[$i];
            $product = $products->get($line['product_id']);
            $discount = $pricedLine->discount;

            $item = new OrderItem;
            $item->forceFill([
                'order_id' => $order->id,
                'branch_id' => $order->branch_id,
                'business_date' => $businessDate,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'category_id' => $product->category_id,
                'category_name' => $product->category->name,
                'sku' => $product->sku,
                'unit_price_cents' => $pricedLine->unitPriceCents,
                'unit_cost_cents' => $product->cost_cents,
                'is_vatable' => $pricedLine->isVatable,
                'qty' => $pricedLine->qty,
                'gross_cents' => $pricedLine->grossCents,
                'discount_type' => $discount?->type ?? Order::NO_DISCOUNT,
                'discount_kind' => $discount?->kind,
                'discount_value' => $discount?->value,
                'line_discount_cents' => $pricedLine->lineDiscountCents,
                'order_discount_share_cents' => $pricedLine->orderDiscountShareCents,
                'line_total_cents' => $pricedLine->lineTotalCents,
                'is_sc_pwd' => $pricedLine->scPwd,
                'sc_pwd_eligible_cents' => $pricedLine->scPwdEligibleCents,
                'sc_pwd_vat_relief_cents' => $pricedLine->scPwdVatReliefCents,
                'sc_pwd_discount_cents' => $pricedLine->scPwdDiscountCents,
                'notes' => $line['notes'],
            ])->save();

            $items[] = $item;
        }

        // The lines as inserted, in the order sent (recipe depletion snapshots them per line).
        $order->setRelation('items', new Collection($items));

        foreach ($payments as $payment) {
            (new Payment)->forceFill([
                'order_id' => $order->id,
                'branch_id' => $order->branch_id,
                'business_date' => $businessDate,
                ...$payment,
            ])->save();
        }

        return $order;
    }

    /**
     * The `sc_pwd` entry of the `order.completed` audit: `{mode, persons_count}`, or null
     * without SC/PWD. The ID numbers are stored on the order, never in the audit log.
     *
     * @return array{mode: string, persons_count: int}|null
     */
    public static function scPwdAudit(PricedSale $sale): ?array
    {
        return $sale->scPwd === null
            ? null
            : ['mode' => $sale->scPwd->mode, 'persons_count' => $sale->scPwd->personsCount()];
    }

    /**
     * One `sale` movement per `track_stock` product, for its demand summed over its lines,
     * each applied to its level (which the caller has locked). Nothing here stops a level
     * going below zero: the online path checked the stock first, the offline path allows it.
     *
     * @param  list<array{product_id: int, qty: int, discount: Discount|null, sc_pwd: bool, notes: string|null}>  $lines
     * @param  Collection<int, Product>  $products
     * @param  SupportCollection<int, StockLevel>  $levels  The locked levels keyed by product id
     */
    public function recordStockMovements(
        Order $order,
        array $lines,
        Collection $products,
        SupportCollection $levels,
        User $actor,
        CarbonInterface $occurredAt,
    ): void {
        foreach ($this->stockDemand($lines, $products) as $productId => $qty) {
            $this->recordStockMovement->execute(
                level: $levels->get($productId),
                type: StockMovement::TYPE_SALE,
                qtyDelta: -$qty,
                unitCostCents: $products->get($productId)->cost_cents,
                actor: $actor,
                occurredAt: $occurredAt,
                reference: $order,
            );
        }
    }
}
