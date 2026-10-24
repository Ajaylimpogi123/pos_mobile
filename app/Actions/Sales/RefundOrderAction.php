<?php

namespace App\Actions\Sales;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Actions\Recipes\RecipeStock;
use App\Actions\Shifts\OpenShiftAction;
use App\Exceptions\ConflictException;
use App\Exceptions\PinLockedException;
use App\Http\Requests\Sales\StoreOrderRequest;
use App\Models\Device;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Refund;
use App\Models\RefundItem;
use App\Models\RefundPayment;
use App\Models\Shift;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\BusinessDay;
use App\Support\Money;
use App\Support\Sales\RefundCalculator;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Refunds a sale in full or line by line (POST /api/v1/orders/{ulid}/refunds, Phase 7). The
 * request has already answered the permission (`403`), the device (`409`), the order's
 * visibility (`404`) and the field rules (`422`, including "a line of this order"). Then, in
 * the contract's order (the first failure wins):
 *
 * 2. **State** (`409`): not voided, not already fully refunded.
 * 3. **Quantities** (`422` on `items.{i}.qty`): no line above its remaining quantity; every
 *    failing line at once.
 * 4. **Checksum** (`422` on `client_refund_cents`): exactly the server's amount
 *    (RefundCalculator: cumulative rounding per line, VAT split once per refund).
 * 5. **Payments** (`422`): they add up to the amount; per method, the refunds so far plus
 *    this one never exceed what that method paid (stored `amount_cents`, net of change).
 * 6. **Shift**: a known, closed shift of the caller's branch is a `422` on `shift_ulid`; a
 *    shift of another tablet is a `409`; an unknown shift is accepted (as for orders).
 * 7. **Approval** (ApproveReversal): the caller's own `sale.refund`, or a manager's PIN,
 *    checked **outside** the transaction so a wrong PIN stays counted.
 *
 * Then one transaction: the order row is locked and checks 2–5 are repeated under the lock
 * (every refund of an order is serialized by that lock). It inserts the refund (its
 * `business_date` is the branch's business day at `refunded_at`, the server time), its lines
 * (in the order sent) and its payments (cash first); adds to the lines' and the order's
 * refunded amounts and sets `refunded` / `partially_refunded`; returns the stock as `refund`
 * movements (ReturnOrderStock); records the refunded share of the recipe components as wasted,
 * with no stock movement (RecipeStock; Round B); and audits `order.refunded`.
 *
 * A refund ULID that is already recorded (a key released after the commit) returns the order
 * as it is; the ULID of another order's refund is a `409`, as for sales.
 */
class RefundOrderAction
{
    public const MESSAGE_VOIDED = "A voided sale can't be refunded.";

    public const MESSAGE_FULLY_REFUNDED = 'This sale is already fully refunded.';

    public const MESSAGE_ONLY_LEFT = 'Only %d left to refund.';

    public const MESSAGE_AMOUNT_CHANGED = 'The refund amount has changed. Review it.';

    public const MESSAGE_MUST_ADD_UP = 'The refund must add up to %s.';

    public const MESSAGE_METHOD_LEFT = 'Only %s paid by %s is left to refund.';

    /**
     * How each method is named in the messages.
     */
    private const METHOD_LABELS = [Payment::METHOD_CASH => 'cash', Payment::METHOD_GCASH => 'GCash'];

    public function __construct(
        private readonly ApproveReversal $approveReversal,
        private readonly ReturnOrderStock $returnOrderStock,
        private readonly RecordAuditLog $recordAuditLog,
        private readonly RecipeStock $recipeStock,
    ) {}

    /**
     * @param  Device  $device  The tablet the caller's token is bound to
     * @param  array<string, mixed>  $input  Validated StoreRefundRequest input
     *
     * @throws ConflictException 409 (state, another tablet's shift, a ULID of another order)
     * @throws ValidationException 422 (checks 3–7)
     * @throws PinLockedException 429
     */
    public function execute(User $caller, Device $device, Order $order, array $input, ?string $ip = null): Order
    {
        $ulid = (string) $input['ulid'];

        if ($this->alreadyRecorded($ulid, $order)) {
            return $order->load(RecordOrder::RESOURCE_RELATIONS);
        }

        $this->check($order, $order->items()->get(), $order->payments()->get(), $input);
        $this->checkShift($caller, $device, (string) $input['shift_ulid']);

        $approver = $this->approveReversal->execute($caller, ApproveReversal::REFUND, $input['authorization'] ?? null);

        try {
            return DB::transaction(fn (): Order => $this->record($caller, $device, $order, $input, $approver, $ip), 3);
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent request recorded the same refund first.
            if ($this->alreadyRecorded($ulid, $order)) {
                return $order->refresh()->load(RecordOrder::RESOURCE_RELATIONS);
            }

            throw $e;
        }
    }

    /**
     * Whether this refund ULID is already recorded for this order.
     *
     * @throws ConflictException when it belongs to another order's refund
     */
    private function alreadyRecorded(string $ulid, Order $order): bool
    {
        $orderId = Refund::query()->where('ulid', $ulid)->value('order_id');

        if ($orderId === null) {
            return false;
        }

        if ((int) $orderId !== $order->id) {
            throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
        }

        return true;
    }

    /**
     * Checks 2–5. Returns the refund's lines, amount and VAT split.
     *
     * @param  Collection<int, OrderItem>  $items  The order's lines
     * @param  Collection<int, Payment>  $payments  The order's payments
     * @param  array<string, mixed>  $input
     * @return array{lines: list<array{item: OrderItem, qty: int, amount_cents: int}>, amount_cents: int, vatable_sales_cents: int, vat_amount_cents: int, vat_exempt_sales_cents: int}
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    private function check(Order $order, Collection $items, Collection $payments, array $input): array
    {
        // 2. State.
        if ($order->status === Order::STATUS_VOIDED) {
            throw new ConflictException(self::MESSAGE_VOIDED);
        }

        if ($order->status === Order::STATUS_REFUNDED) {
            throw new ConflictException(self::MESSAGE_FULLY_REFUNDED);
        }

        // 3. Quantities.
        $itemsById = $items->keyBy('id');
        $errors = [];

        foreach (array_values($input['items']) as $i => $line) {
            /** @var OrderItem $item */
            $item = $itemsById->get((int) $line['order_item_id']);

            if ((int) $line['qty'] > $item->refundableQty()) {
                $errors["items.{$i}.qty"] = sprintf(self::MESSAGE_ONLY_LEFT, $item->refundableQty());
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        // 4. Checksum.
        $lines = [];
        $vatable = 0;
        $vatExempt = 0;

        foreach (array_values($input['items']) as $line) {
            /** @var OrderItem $item */
            $item = $itemsById->get((int) $line['order_item_id']);
            $qty = (int) $line['qty'];
            $amount = RefundCalculator::lineAmount($item->line_total_cents, $item->wholeQty(), $item->wholeRefundedQty(), $qty);

            $lines[] = ['item' => $item, 'qty' => $qty, 'amount_cents' => $amount];

            // SC/PWD: only a VAT-able line's taxable part τ = line_total − X is VAT-able; the
            // rest of its refund is VAT-exempt (X = 0 without a VAT-exempt SC/PWD).
            $taxable = $item->is_vatable
                ? RefundCalculator::taxableAmount(
                    $amount,
                    $item->line_total_cents - $item->scPwdExemptCents($order->sc_pwd_vat_exempt),
                    $item->wholeQty(),
                    $item->wholeRefundedQty(),
                    $qty,
                )
                : 0;

            $vatable += $taxable;
            $vatExempt += $amount - $taxable;
        }

        // Dine-in Tables & Tabs → E: the refund that leaves no refundable quantity also returns
        // the service charge `S` (outside the VAT figures); a partial refund doesn't.
        $serviceCharge = $order->service_charge_cents > 0 && self::leavesNothingRefundable($items, $input['items'])
            ? $order->service_charge_cents
            : 0;

        $amountCents = $vatable + $vatExempt + $serviceCharge;

        if ((int) $input['client_refund_cents'] !== $amountCents) {
            throw ValidationException::withMessages(['client_refund_cents' => self::MESSAGE_AMOUNT_CHANGED]);
        }

        // 5. Payments.
        $this->checkPayments($order, $payments, array_values($input['payments']), $amountCents);

        return [
            'lines' => $lines,
            'amount_cents' => $amountCents,
            ...RefundCalculator::fromConfig()->vatSplit($vatable, $vatExempt),
        ];
    }

    /**
     * Whether, after this refund, no line has any refundable quantity left.
     *
     * @param  Collection<int, OrderItem>  $items  The order's lines
     * @param  array<int, array<string, mixed>>  $refundLines  The refund's lines as sent
     */
    private static function leavesNothingRefundable(Collection $items, array $refundLines): bool
    {
        $refunding = [];

        foreach ($refundLines as $line) {
            $refunding[(int) $line['order_item_id']] = ($refunding[(int) $line['order_item_id']] ?? 0) + (int) $line['qty'];
        }

        return $items->every(fn (OrderItem $item) => $item->refundableQty() - ($refunding[$item->id] ?? 0) <= 0);
    }

    /**
     * Check 5: the payments add up to the amount, then no method goes above what it paid.
     *
     * @param  Collection<int, Payment>  $payments  The order's payments
     * @param  list<array<string, mixed>>  $refundPayments  The refund's payments as sent
     *
     * @throws ValidationException
     */
    private function checkPayments(Order $order, Collection $payments, array $refundPayments, int $amountCents): void
    {
        $sum = array_sum(array_map(fn (array $payment) => (int) $payment['amount_cents'], $refundPayments));

        if ($sum !== $amountCents) {
            throw ValidationException::withMessages(['payments' => sprintf(self::MESSAGE_MUST_ADD_UP, Money::format($amountCents))]);
        }

        $refundedSoFar = DB::table('refund_payments')
            ->join('refunds', 'refunds.id', '=', 'refund_payments.refund_id')
            ->where('refunds.order_id', $order->id)
            ->groupBy('refund_payments.method')
            ->select('refund_payments.method')
            ->selectRaw('SUM('.DB::getQueryGrammar()->wrap('refund_payments.amount_cents').') AS amount_cents')
            ->pluck('amount_cents', 'method');

        $errors = [];

        foreach ($refundPayments as $i => $payment) {
            $method = (string) $payment['method'];
            $paid = (int) $payments->where('method', $method)->sum('amount_cents');
            $left = $paid - (int) ($refundedSoFar[$method] ?? 0);

            if ((int) $payment['amount_cents'] > $left) {
                $errors["payments.{$i}.amount_cents"] = sprintf(self::MESSAGE_METHOD_LEFT, Money::format(max(0, $left)), self::METHOD_LABELS[$method]);
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * Check 6: a shift the caller's branch knows must be open and belong to the caller's
     * tablet. A shift the server doesn't know yet is accepted.
     *
     * @throws ValidationException
     * @throws ConflictException
     */
    private function checkShift(User $caller, Device $device, string $shiftUlid): void
    {
        $shift = Shift::query()
            ->where('branch_id', $caller->branch_id)
            ->where('ulid', $shiftUlid)
            ->first();

        if ($shift === null) {
            return;
        }

        if (! $shift->isOpen()) {
            throw ValidationException::withMessages(['shift_ulid' => StoreOrderRequest::MESSAGE_SHIFT_CLOSED]);
        }

        if ($shift->device_id !== $device->id) {
            throw new ConflictException(OpenShiftAction::MESSAGE_OTHER_TABLET);
        }
    }

    /**
     * Checks 2–5 again under the order's lock, then every write.
     *
     * @param  array<string, mixed>  $input
     */
    private function record(User $caller, Device $device, Order $order, array $input, ?User $approver, ?string $ip): Order
    {
        /** @var Order $locked */
        $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
        $items = $locked->items()->get();

        $refund = $this->check($locked, $items, $locked->payments()->get(), $input);

        $caller->loadMissing('branch');
        $now = now()->startOfSecond();
        $businessDate = BusinessDay::forBranch($caller->branch)->dateOf($now);
        $reason = (string) $input['reason'];

        $record = new Refund;
        $record->forceFill([
            'ulid' => (string) $input['ulid'],
            'order_id' => $locked->id,
            'branch_id' => $locked->branch_id,
            'business_date' => $businessDate,
            'shift_ulid' => (string) $input['shift_ulid'],
            'device_id' => $device->id,
            'refunded_by' => $caller->id,
            'authorized_by' => $approver?->id,
            'reason' => $reason,
            'amount_cents' => $refund['amount_cents'],
            'vatable_sales_cents' => $refund['vatable_sales_cents'],
            'vat_amount_cents' => $refund['vat_amount_cents'],
            'vat_exempt_sales_cents' => $refund['vat_exempt_sales_cents'],
            'refunded_at' => $now,
        ])->save();

        $wasteLines = [];

        foreach ($refund['lines'] as $line) {
            $item = $line['item'];
            $refundedBefore = $item->wholeRefundedQty();

            $refundItem = new RefundItem;
            $refundItem->forceFill([
                'refund_id' => $record->id,
                'order_item_id' => $item->id,
                'branch_id' => $locked->branch_id,
                'business_date' => $businessDate,
                'product_id' => $item->product_id,
                'category_id' => $item->category_id,
                'qty' => $line['qty'],
                'amount_cents' => $line['amount_cents'],
            ]);
            $refundItem->save();

            $wasteLines[] = ['refund_item_id' => $refundItem->id, 'item' => $item, 'qty' => $line['qty'], 'refunded_before' => $refundedBefore];

            $item->forceFill([
                'refunded_qty' => $item->wholeRefundedQty() + $line['qty'],
                'refunded_cents' => $item->refunded_cents + $line['amount_cents'],
            ])->save();
        }

        // Cash first.
        $payments = collect($input['payments'])->sortBy(fn (array $payment) => array_search($payment['method'], Payment::METHODS, true))->values();

        foreach ($payments as $payment) {
            (new RefundPayment)->forceFill([
                'refund_id' => $record->id,
                'branch_id' => $locked->branch_id,
                'business_date' => $businessDate,
                'method' => (string) $payment['method'],
                'amount_cents' => (int) $payment['amount_cents'],
                'reference_no' => $payment['method'] === Payment::METHOD_GCASH ? $payment['reference_no'] : null,
            ])->save();
        }

        $fullyRefunded = $items->every(fn (OrderItem $item) => $item->refundableQty() === 0);

        $locked->forceFill([
            'refunded_cents' => $locked->refunded_cents + $refund['amount_cents'],
            'status' => $fullyRefunded ? Order::STATUS_REFUNDED : Order::STATUS_PARTIALLY_REFUNDED,
        ])->save();

        $this->returnOrderStock->execute(
            order: $locked,
            returns: array_map(fn (array $line) => ['item' => $line['item'], 'qty' => $line['qty']], $refund['lines']),
            type: StockMovement::TYPE_REFUND,
            reference: $record,
            actor: $caller,
            occurredAt: $now,
        );

        // Round B: the refunded share of the recipe components is wasted, not returned.
        $this->recipeStock->recordRefundWaste($record, $wasteLines, $now);

        $this->recordAuditLog->execute(
            action: 'order.refunded',
            actor: $caller,
            subject: $locked,
            changes: [
                'invoice_no' => $locked->invoice_no,
                'refund_ulid' => $record->ulid,
                'amount_cents' => $record->amount_cents,
                'reason' => $reason,
                'authorized_by' => $approver?->id,
            ],
            ip: $ip,
        );

        return $locked->load(RecordOrder::RESOURCE_RELATIONS);
    }
}
