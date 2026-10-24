<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Tab;
use App\Models\TabItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Merges an open tab into another open tab of the branch (POST /api/v1/tabs/{ulid}/merge, T2,
 * Dine-in Tables & Tabs → D.9). Both tabs are locked in id order (so two opposite merges
 * can't deadlock); the source must still be open (`409`) and the target too (`422` on
 * `into_ulid`).
 *
 * Every remaining quantity moves to the target as new lines in the target's next round,
 * with the snapshots (prices), notes and who added them kept; no kitchen ticket is printed.
 * The moved quantity leaves the source line (its `qty` drops to settled + cancelled), so the
 * source keeps only what it settled or cancelled. `guests` are added together. The source
 * becomes `merged` (`merged_into_tab_id`, closed, its table freed); orders already settled
 * from it stay linked to it. The target may not go above 200 lines (`422` on `into_ulid`).
 * Audit: `tab.merged` on both tabs.
 */
class MergeTabAction
{
    public function __construct(
        private readonly LockOpenTab $lockOpenTab,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @return Tab The target tab
     *
     * @throws ConflictException
     * @throws ValidationException
     */
    public function execute(Tab $source, string $intoUlid, User $actor, ?string $ip = null): Tab
    {
        LockOpenTab::ensureOpen($source);

        return DB::transaction(function () use ($source, $intoUlid, $actor, $ip): Tab {
            $targetId = Tab::query()
                ->where('branch_id', $source->branch_id)
                ->where('ulid', $intoUlid)
                ->whereKeyNot($source->id)
                ->value('id');

            $invalid = fn () => ValidationException::withMessages(['into_ulid' => trans('validation.exists', ['attribute' => 'into ulid'])]);

            if ($targetId === null) {
                throw $invalid();
            }

            $locked = Tab::query()->whereKey([$source->id, $targetId])->orderBy('id')->lockForUpdate()->get()->keyBy('id');

            /** @var Tab $from */
            $from = $locked->get($source->id);
            /** @var Tab $into */
            $into = $locked->get($targetId);

            LockOpenTab::ensureOpen($from);

            if (! $into->isOpen()) {
                throw $invalid();
            }

            $moving = TabItem::query()
                ->where('tab_id', $from->id)
                ->orderBy('round_no')
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->filter(fn (TabItem $item) => $item->remainingQty() > 0)
                ->values();

            if (TabItem::query()->where('tab_id', $into->id)->count() + $moving->count() > Tab::MAX_LINES) {
                throw ValidationException::withMessages(['into_ulid' => SendRoundAction::MESSAGE_TOO_MANY_LINES]);
            }

            $roundNo = $into->rounds_count + 1;
            $moved = [];

            foreach ($moving as $item) {
                $qty = $item->remainingQty();
                $moved[] = ['product_id' => $item->product_id, 'qty' => $qty];

                (new TabItem)->forceFill([
                    'tab_id' => $into->id,
                    'round_no' => $roundNo,
                    ...$item->only([
                        'product_id', 'product_name', 'category_id', 'category_name', 'sku',
                        'unit_price_cents', 'is_vatable', 'notes', 'added_by', 'added_at',
                    ]),
                    'qty' => $qty,
                ])->save();

                $item->forceFill(['qty' => $item->qty - $qty])->save();
            }

            $into->forceFill([
                'guests' => $into->guests + $from->guests,
                'rounds_count' => $moving->isEmpty() ? $into->rounds_count : $roundNo,
            ])->save();
            $into->touch();

            CloseTabAction::close($from, $actor, Tab::STATUS_MERGED, ['merged_into_tab_id' => $into->id]);

            $this->recordAuditLog->execute(
                action: 'tab.merged',
                actor: $actor,
                subject: $from,
                changes: ['into_ulid' => $into->ulid, 'items' => $moved],
                ip: $ip,
            );

            $this->recordAuditLog->execute(
                action: 'tab.merged',
                actor: $actor,
                subject: $into,
                changes: ['from_ulid' => $from->ulid, 'items' => $moved],
                ip: $ip,
            );

            return $into->refresh()->load(Tab::RESOURCE_RELATIONS);
        });
    }
}
