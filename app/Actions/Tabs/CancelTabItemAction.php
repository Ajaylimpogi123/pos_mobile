<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Sales\ApproveReversal;
use App\Exceptions\ConflictException;
use App\Exceptions\PinLockedException;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\TabItemCancellation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Cancels a quantity already sent to the kitchen (POST /api/v1/tabs/{ulid}/items/{id}/cancel,
 * Dine-in Tables & Tabs → D.5). In order:
 *
 * 1. **State:** a tab that isn't open is a `409`.
 * 2. **Authority:** the rules and messages of a void (ApproveReversal, `sale.void`): the
 *    caller's own `sale.void`, or a manager's PIN through the shared limiter (`429`), checked
 *    outside the transaction so a wrong PIN stays counted.
 * 3. One transaction under the tab's lock: the quantity is re-checked (`409 "This bill
 *    changed on another device. Review it again."` when another device settled or cancelled
 *    it first), `cancelled_qty` grows, a `tab_item_cancellations` row is written (its `ulid`
 *    is the Idempotency-Key) and `tab.item_cancelled` is audited. No stock moves: stock only
 *    depletes at settlement.
 */
class CancelTabItemAction
{
    public function __construct(
        private readonly ApproveReversal $approveReversal,
        private readonly LockOpenTab $lockOpenTab,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @param  array<string, mixed>  $input  Validated CancelTabItemRequest input
     * @param  string  $key  The request's Idempotency-Key (the cancellation's ulid)
     *
     * @throws ConflictException
     * @throws ValidationException
     * @throws PinLockedException
     */
    public function execute(Tab $tab, TabItem $item, User $actor, array $input, string $key, ?string $ip = null): Tab
    {
        if (TabItemCancellation::query()->where('ulid', $key)->where('tab_item_id', $item->id)->exists()) {
            return $tab->refresh()->load(Tab::RESOURCE_RELATIONS);
        }

        LockOpenTab::ensureOpen($tab);

        $actor->loadMissing('role.permissions');
        $approver = $this->approveReversal->execute($actor, ApproveReversal::VOID, $input['authorization'] ?? null);

        return DB::transaction(function () use ($tab, $item, $actor, $input, $key, $approver, $ip): Tab {
            $locked = $this->lockOpenTab->execute($tab);

            /** @var TabItem $line */
            $line = TabItem::query()->whereKey($item->id)->lockForUpdate()->firstOrFail();
            $qty = (int) $input['qty'];

            if ($qty > $line->remainingQty()) {
                throw new ConflictException(LockOpenTab::MESSAGE_CHANGED);
            }

            $line->forceFill(['cancelled_qty' => $line->cancelled_qty + $qty])->save();

            (new TabItemCancellation)->forceFill([
                'ulid' => $key,
                'tab_item_id' => $line->id,
                'qty' => $qty,
                'reason' => (string) $input['reason'],
                'cancelled_by' => $actor->id,
                'authorized_by' => $approver?->id,
            ])->save();

            $locked->touch();

            $this->recordAuditLog->execute(
                action: 'tab.item_cancelled',
                actor: $actor,
                subject: $locked,
                changes: [
                    'tab_item_id' => $line->id,
                    'product_name' => $line->product_name,
                    'qty' => $qty,
                    'reason' => (string) $input['reason'],
                    'authorized_by' => $approver?->id,
                ],
                ip: $ip,
            );

            return $locked->refresh()->load(Tab::RESOURCE_RELATIONS);
        });
    }
}
