<?php

namespace App\Actions\Purchasing;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Exceptions\ConflictException;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use App\Models\User;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;

/**
 * Creates a purchase request in the caller's branch (POST /api/v1/purchase-requests;
 * Ingredients, Recipes & Purchasing → F): its `pr_no` (AllocatePurchaseNumber), the items (all
 * `pending`) and the `pr.created` audit entry (`{ pr_no, items }`), in one transaction.
 *
 * Idempotent by `ulid`: normally the idempotency middleware replays a repeat; when the key was
 * released after the commit, the PR already stored under this ULID (same branch and requester)
 * is returned as it is. The ULID of another branch's or user's PR is a 409.
 */
class CreatePurchaseRequestAction
{
    public function __construct(
        private readonly AllocatePurchaseNumber $numbers,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @param  list<PurchaseRequestItemInput>  $items
     */
    public function execute(User $actor, string $ulid, ?string $dateNeeded, ?string $remarks, array $items, ?string $ip = null): PurchaseRequest
    {
        $existing = PurchaseRequest::query()->where('ulid', $ulid)->first();

        if ($existing !== null) {
            if ($existing->branch_id !== $actor->branch_id || $existing->requested_by !== $actor->id) {
                throw new ConflictException(ClaimIdempotencyKey::MESSAGE_DIFFERENT_REQUEST);
            }

            return $existing;
        }

        return DB::transaction(function () use ($actor, $ulid, $dateNeeded, $remarks, $items, $ip): PurchaseRequest {
            $branchId = (int) $actor->branch_id;

            $purchaseRequest = new PurchaseRequest;
            $purchaseRequest->forceFill([
                'ulid' => $ulid,
                'branch_id' => $branchId,
                'pr_no' => $this->numbers->purchaseRequest($branchId),
                'requested_by' => $actor->id,
                'status' => PurchaseRequest::STATUS_PENDING,
                'date_needed' => $dateNeeded,
                'remarks' => $remarks,
            ])->save();

            foreach ($items as $item) {
                self::newItem($purchaseRequest, $item)->save();
            }

            $this->recordAuditLog->execute(
                action: 'pr.created',
                actor: $actor,
                subject: $purchaseRequest,
                changes: ['pr_no' => $purchaseRequest->pr_no, 'items' => array_map(fn (PurchaseRequestItemInput $item) => self::describe($item), $items)],
                ip: $ip,
            );

            return $purchaseRequest;
        });
    }

    /**
     * A new pending item of the PR from a validated input (not saved).
     */
    public static function newItem(PurchaseRequest $purchaseRequest, PurchaseRequestItemInput $input): PurchaseRequestItem
    {
        $item = new PurchaseRequestItem;
        $item->forceFill([
            'purchase_request_id' => $purchaseRequest->id,
            // The PR's branch and creation time, for the purchasing report's index (immutable).
            'branch_id' => $purchaseRequest->branch_id,
            'requested_at' => $purchaseRequest->created_at,
            'decision' => PurchaseRequestItem::DECISION_PENDING,
        ]);

        return self::fill($item, $input);
    }

    /**
     * Write an input's fields onto an item (not saved).
     */
    public static function fill(PurchaseRequestItem $item, PurchaseRequestItemInput $input): PurchaseRequestItem
    {
        return $item->forceFill([
            ...$input->itemColumns(),
            'supplier_id' => $input->supplierId,
            'qty' => $input->quantity->qty,
            'unit' => $input->quantity->unit->name,
            'unit_factor' => (string) BigDecimal::of($input->quantity->unit->factor)->toScale(12),
            'base_qty' => (string) $input->quantity->baseQty,
            'estimated_unit_price_cents' => $input->estimatedUnitPriceCents,
            'remarks' => $input->remarks,
        ]);
    }

    /**
     * An item as recorded in the audit entries.
     *
     * @return array<string, mixed>
     */
    public static function describe(PurchaseRequestItemInput $input): array
    {
        return [
            'item' => $input->item->name,
            'supplier_id' => $input->supplierId,
            'qty' => $input->quantity->qty,
            'unit' => $input->quantity->unit->name,
            'estimated_unit_price_cents' => $input->estimatedUnitPriceCents,
        ];
    }
}
