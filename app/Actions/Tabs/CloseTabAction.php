<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Order;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Closes a tab with nothing left to pay (POST /api/v1/tabs/{ulid}/close, Dine-in Tables &
 * Tabs → D.7): everything was cancelled, or the tab was opened by mistake. Under the tab's
 * lock: quantity left is a `409 "Settle or cancel the remaining items first."`. The status
 * becomes `closed` when the tab has orders, otherwise `cancelled`; the table is freed.
 * Audit: `tab.closed`.
 */
class CloseTabAction
{
    public const MESSAGE_REMAINING = 'Settle or cancel the remaining items first.';

    public function __construct(
        private readonly LockOpenTab $lockOpenTab,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @throws ConflictException
     */
    public function execute(Tab $tab, User $actor, ?string $ip = null): Tab
    {
        return DB::transaction(function () use ($tab, $actor, $ip): Tab {
            $locked = $this->lockOpenTab->execute($tab);

            $remaining = TabItem::query()->where('tab_id', $locked->id)->get()->sum(fn (TabItem $item) => $item->remainingQty());

            if ($remaining > 0) {
                throw new ConflictException(self::MESSAGE_REMAINING);
            }

            $hasOrders = Order::query()->where('tab_id', $locked->id)->exists();

            self::close($locked, $actor, $hasOrders ? Tab::STATUS_CLOSED : Tab::STATUS_CANCELLED);

            $this->recordAuditLog->execute(
                action: 'tab.closed',
                actor: $actor,
                subject: $locked,
                changes: ['status' => $locked->status],
                ip: $ip,
            );

            return $locked->refresh()->load(Tab::RESOURCE_RELATIONS);
        });
    }

    /**
     * Ends a locked tab with the given status and frees its table.
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function close(Tab $tab, User $actor, string $status, array $attributes = []): void
    {
        $tab->forceFill([
            'status' => $status,
            'open_table_id' => null,
            'closed_by' => $actor->id,
            'closed_at' => now()->startOfSecond(),
            ...$attributes,
        ])->save();
    }
}
