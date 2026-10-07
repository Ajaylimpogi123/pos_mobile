<?php

namespace App\Actions\Sales;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Recipes\RecipeStock;
use App\Exceptions\ConflictException;
use App\Exceptions\PinLockedException;
use App\Models\Device;
use App\Models\Order;
use App\Models\Shift;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Voids a completed sale (POST /api/v1/orders/{ulid}/void, Phase 7). The request has
 * already answered the permission (`403`), the device (`409`), the order's visibility
 * (`404`) and the field rules (`422`). Then, in the contract's order (the first failure
 * wins):
 *
 * 2. **State** (`409`): not already voided, and no refunds.
 * 3. **Window** (`409`): the order's shift is known to its branch and still **open**, and it
 *    belongs to the caller's tablet (the cash goes back from that drawer). A sale without a
 *    shift (before Phase 6), or with a shift the server doesn't know, can't be voided.
 * 4. **Approval** (ApproveReversal): the caller's own `sale.void`, or a manager's PIN,
 *    checked **outside** the transaction so a wrong PIN stays counted.
 *
 * Then one transaction: the order row is locked and checks 2–3 are repeated under the lock
 * (the shift row is read with a shared lock, so a concurrent close waits). The order gets
 * `status = voided`, `voided_at`, `voided_by`, `void_reason` and `void_authorized_by`; its
 * stock comes back as `void` movements (ReturnOrderStock), and its recipe components too
 * (RecipeStock, at the snapshot cost; Round B); `order.voided` is audited.
 * Payments are not changed: a voided order simply leaves every sales figure.
 */
class VoidOrderAction
{
    public const MESSAGE_ALREADY_VOIDED = 'This sale is already voided.';

    public const MESSAGE_HAS_REFUNDS = "This sale has refunds, so it can't be voided. Refund the rest instead.";

    public const MESSAGE_SHIFT_CLOSED = "This sale's shift is closed. Refund it instead.";

    public const MESSAGE_OTHER_TABLET = 'Void this sale on the tablet that sold it (%s).';

    public function __construct(
        private readonly ApproveReversal $approveReversal,
        private readonly ReturnOrderStock $returnOrderStock,
        private readonly RecordAuditLog $recordAuditLog,
        private readonly RecipeStock $recipeStock,
    ) {}

    /**
     * @param  Device  $device  The tablet the caller's token is bound to
     * @param  array<string, mixed>  $input  Validated VoidOrderRequest input
     *
     * @throws ConflictException 409 (state, window)
     * @throws ValidationException 422 (approval)
     * @throws PinLockedException 429
     */
    public function execute(User $caller, Device $device, Order $order, array $input, ?string $ip = null): Order
    {
        $this->checkState($order);
        $this->checkWindow($order, $device, lock: false);

        $approver = $this->approveReversal->execute($caller, ApproveReversal::VOID, $input['authorization'] ?? null);

        return DB::transaction(function () use ($caller, $device, $order, $input, $approver, $ip): Order {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            $this->checkState($locked);
            $this->checkWindow($locked, $device, lock: true);

            $now = now()->startOfSecond();
            $reason = (string) $input['reason'];

            $locked->forceFill([
                'status' => Order::STATUS_VOIDED,
                'voided_at' => $now,
                'voided_by' => $caller->id,
                'void_reason' => $reason,
                'void_authorized_by' => $approver?->id,
            ])->save();

            $items = $locked->items()->get();

            $this->returnOrderStock->execute(
                order: $locked,
                returns: $items->map(fn ($item) => ['item' => $item, 'qty' => $item->wholeQty()])->values()->all(),
                type: StockMovement::TYPE_VOID,
                reference: $locked,
                actor: $caller,
                occurredAt: $now,
            );

            // Round B: the recipe components come back at their snapshot cost.
            $this->recipeStock->returnVoided($locked, $caller, $now);

            $this->recordAuditLog->execute(
                action: 'order.voided',
                actor: $caller,
                subject: $locked,
                changes: [
                    'invoice_no' => $locked->invoice_no,
                    'total_cents' => $locked->total_cents,
                    'reason' => $reason,
                    'authorized_by' => $approver?->id,
                ],
                ip: $ip,
            );

            return $locked->load(RecordOrder::RESOURCE_RELATIONS);
        }, 3);
    }

    /**
     * Check 2.
     *
     * @throws ConflictException
     */
    private function checkState(Order $order): void
    {
        if ($order->status === Order::STATUS_VOIDED) {
            throw new ConflictException(self::MESSAGE_ALREADY_VOIDED);
        }

        if ($order->status !== Order::STATUS_COMPLETED) {
            throw new ConflictException(self::MESSAGE_HAS_REFUNDS);
        }
    }

    /**
     * Check 3: the order's shift, in the order's branch, must be open and belong to the
     * caller's tablet.
     *
     * @throws ConflictException
     */
    private function checkWindow(Order $order, Device $device, bool $lock): void
    {
        $shift = $order->shift_ulid === null ? null : Shift::query()
            ->where('branch_id', $order->branch_id)
            ->where('ulid', $order->shift_ulid)
            ->when($lock, fn ($query) => $query->sharedLock())
            ->first();

        if ($shift === null || ! $shift->isOpen()) {
            throw new ConflictException(self::MESSAGE_SHIFT_CLOSED);
        }

        if ($shift->device_id !== $device->id) {
            throw new ConflictException(sprintf(self::MESSAGE_OTHER_TABLET, $shift->device->code));
        }
    }
}
