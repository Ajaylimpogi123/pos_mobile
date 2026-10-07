<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Edits a purchase request (PATCH /api/v1/purchase-requests/{ulid}) or cancels it
 * (DELETE /api/v1/purchase-requests/{ulid}; Ingredients, Recipes & Purchasing → F), under the PR's
 * row lock and only while no item has been decided: otherwise
 * `409 This request is already being reviewed.` A cancelled PR is
 * `409 This request was cancelled.` (provisional, Q-030).
 *
 * - An edit changes `date_needed` / `remarks` as sent, and when `items` is sent updates the items
 *   **by id** (in place), adds those without an id and removes the PR's items missing from the
 *   set; nothing is deleted and re-created. Audit `pr.updated` with the changes (only when
 *   something changed).
 * - A cancel sets `status = cancelled` (with who and when); the PR is never deleted. Audit
 *   `pr.cancelled`.
 */
class UpdatePurchaseRequestAction
{
    public const MESSAGE_UNDER_REVIEW = 'This request is already being reviewed.';

    public const MESSAGE_CANCELLED = 'This request was cancelled.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, string|null>  $fields  `date_needed` / `remarks` as sent
     * @param  list<PurchaseRequestItemInput>|null  $items  The new set, or null when not sent
     *
     * @throws ConflictException
     */
    public function update(PurchaseRequest $purchaseRequest, array $fields, ?array $items, User $actor, ?string $ip = null): PurchaseRequest
    {
        return DB::transaction(function () use ($purchaseRequest, $fields, $items, $actor, $ip): PurchaseRequest {
            $this->lockEditable($purchaseRequest);

            $purchaseRequest->forceFill($fields);
            $changes = [];

            foreach (['date_needed', 'remarks'] as $field) {
                if ($purchaseRequest->isDirty($field)) {
                    $changes[$field] = [
                        'from' => $this->plain($purchaseRequest->getOriginal($field)),
                        'to' => $this->plain($purchaseRequest->getAttribute($field)),
                    ];
                }
            }

            if ($items !== null) {
                $itemChanges = $this->replaceItems($purchaseRequest, $items);

                if ($itemChanges !== []) {
                    $changes['items'] = $itemChanges;
                }
            }

            if ($changes === []) {
                return $purchaseRequest;
            }

            $purchaseRequest->touch();

            $this->recordAuditLog->execute(
                action: 'pr.updated',
                actor: $actor,
                subject: $purchaseRequest,
                changes: $changes,
                ip: $ip,
            );

            return $purchaseRequest;
        });
    }

    /**
     * @throws ConflictException
     */
    public function cancel(PurchaseRequest $purchaseRequest, User $actor, ?string $ip = null): void
    {
        DB::transaction(function () use ($purchaseRequest, $actor, $ip): void {
            $this->lockEditable($purchaseRequest);

            $purchaseRequest->forceFill([
                'status' => PurchaseRequest::STATUS_CANCELLED,
                'cancelled_by' => $actor->id,
                'cancelled_at' => now(),
            ])->save();

            $this->recordAuditLog->execute(
                action: 'pr.cancelled',
                actor: $actor,
                subject: $purchaseRequest,
                changes: ['pr_no' => $purchaseRequest->pr_no, 'status' => ['from' => PurchaseRequest::STATUS_PENDING, 'to' => PurchaseRequest::STATUS_CANCELLED]],
                ip: $ip,
            );
        });
    }

    /**
     * Lock the PR and check it can still be edited.
     *
     * @throws ConflictException
     */
    private function lockEditable(PurchaseRequest $purchaseRequest): void
    {
        $locked = PurchaseRequest::query()->whereKey($purchaseRequest->id)->lockForUpdate()->firstOrFail();

        if ($locked->status === PurchaseRequest::STATUS_CANCELLED) {
            throw new ConflictException(self::MESSAGE_CANCELLED);
        }

        if ($locked->status !== PurchaseRequest::STATUS_PENDING || $locked->hasDecisions()) {
            throw new ConflictException(self::MESSAGE_UNDER_REVIEW);
        }
    }

    /**
     * Apply the new item set by id. Returns `{ added, updated, removed }` (the non-empty parts).
     *
     * @param  list<PurchaseRequestItemInput>  $items
     * @return array<string, list<array<string, mixed>>>
     */
    private function replaceItems(PurchaseRequest $purchaseRequest, array $items): array
    {
        $existing = $purchaseRequest->items()->get()->keyBy('id');
        $kept = collect($items)->pluck('id')->filter()->all();

        $added = [];
        $updated = [];
        $removed = [];

        foreach ($existing as $id => $item) {
            if (! in_array($id, $kept, true)) {
                $removed[] = ['id' => $id];
                $item->delete();
            }
        }

        foreach ($items as $input) {
            if ($input->id === null) {
                $item = CreatePurchaseRequestAction::newItem($purchaseRequest, $input);
                $item->save();
                $added[] = ['id' => $item->id, ...CreatePurchaseRequestAction::describe($input)];

                continue;
            }

            /** @var PurchaseRequestItem $item */
            $item = $existing->get($input->id);
            CreatePurchaseRequestAction::fill($item, $input);

            if ($item->isDirty()) {
                $item->save();
                $updated[] = ['id' => $item->id, ...CreatePurchaseRequestAction::describe($input)];
            }
        }

        return array_filter(['added' => $added, 'updated' => $updated, 'removed' => $removed]);
    }

    private function plain(mixed $value): mixed
    {
        return $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : $value;
    }
}
