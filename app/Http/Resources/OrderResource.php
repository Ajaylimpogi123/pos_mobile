<?php

namespace App\Http\Resources;

use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The contract's `Order` object (Phase 3). Load `cashier`, `approver`, `reviewer`,
 * `customer`, `items` and `payments` (RecordOrder::RESOURCE_RELATIONS). The customer is
 * the current record (no name snapshot); `unit_cost_cents` is never returned.
 *
 * Phase 5 adds `order_no`, `source`, `needs_review`, `review_reasons`, `reviewed_at`,
 * `reviewed_by` and `synced_at` (OrderResource::offlineFields()). Phase 6 adds `shift_ulid`
 * after them. Phase 7 adds `voided_at`, `voided_by`, `void_reason`, `void_authorized_by`,
 * `refunded_cents`, `items[].refunded_qty` / `refunded_cents` and `refunds` (oldest first,
 * `[]` when none); load the relations in RecordOrder::RESOURCE_RELATIONS. The SC/PWD feature
 * adds `sc_pwd` (after `order_discount`) and the lines' SC/PWD fields.
 *
 * @mixin Order
 */
class OrderResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Order $order */
        $order = $this->resource;
        $orderDiscount = $order->orderDiscount();

        return [
            'ulid' => $order->ulid,
            'invoice_no' => $order->invoice_no,
            'order_no' => $order->order_no,
            'queue_no' => $order->queue_no,
            'table_no' => $order->table_no,
            'business_date' => $order->business_date,
            'status' => $order->status,
            'placed_at' => $order->placed_at->toIso8601ZuluString(),
            'cashier' => ['id' => $order->cashier->id, 'name' => $order->cashier->name],
            'authorized_by' => $order->approver === null
                ? null
                : ['id' => $order->approver->id, 'name' => $order->approver->name],
            'customer' => $order->customer === null
                ? null
                : ['id' => $order->customer->id, 'full_name' => $order->customer->full_name],
            'notes' => $order->notes,
            'subtotal_cents' => $order->subtotal_cents,
            'line_discounts_cents' => $order->line_discounts_cents,
            'order_discount' => $orderDiscount === null
                ? null
                : [...$orderDiscount->toArray(), 'amount_cents' => $order->order_discount_cents],
            // SC/PWD: null without it; `vat_relief_cents` = R and `discount_cents` = S.
            'sc_pwd' => self::scPwd($order),
            // Includes the SC/PWD R + S; `line_discounts_cents` stays the regular ones only.
            'discount_cents' => $order->discount_cents,
            'total_cents' => $order->total_cents,
            'vatable_sales_cents' => $order->vatable_sales_cents,
            'vat_amount_cents' => $order->vat_amount_cents,
            'vat_exempt_sales_cents' => $order->vat_exempt_sales_cents,
            'tendered_cents' => $order->tendered_cents,
            'change_cents' => $order->change_cents,
            'client_total_cents' => $order->client_total_cents,
            'has_total_mismatch' => $order->has_total_mismatch,
            ...self::offlineFields($order),
            // Phase 6: null only for orders placed before shifts existed.
            'shift_ulid' => $order->shift_ulid,
            // Phase 7: the void (all null unless voided) and the refunds.
            'voided_at' => $order->voided_at?->toIso8601ZuluString(),
            'voided_by' => $order->voider === null
                ? null
                : ['id' => $order->voider->id, 'name' => $order->voider->name],
            'void_reason' => $order->void_reason,
            'void_authorized_by' => $order->voidAuthorizer === null
                ? null
                : ['id' => $order->voidAuthorizer->id, 'name' => $order->voidAuthorizer->name],
            'refunded_cents' => $order->refunded_cents,
            'items' => OrderItemResource::collection($order->items),
            'payments' => PaymentResource::collection($order->payments),
            'refunds' => RefundResource::collection($order->refunds),
        ];
    }

    /**
     * The SC/PWD block: `{ mode, persons: [{type, id_no}], diners, vat_exempt,
     * vat_relief_cents, discount_cents }`, or null.
     *
     * @return array{mode: string, persons: list<array{type: string, id_no: string}>, diners: int|null, vat_exempt: bool, vat_relief_cents: int, discount_cents: int}|null
     */
    private static function scPwd(Order $order): ?array
    {
        if (! $order->hasScPwd()) {
            return null;
        }

        return [
            'mode' => $order->sc_pwd_mode,
            'persons' => array_map(fn (array $person) => [
                'type' => $person['type'],
                'id_no' => $person['id_no'],
            ], array_values($order->sc_pwd_persons ?? [])),
            'diners' => $order->sc_pwd_diners,
            'vat_exempt' => $order->sc_pwd_vat_exempt,
            'vat_relief_cents' => $order->sc_pwd_vat_relief_cents,
            'discount_cents' => $order->sc_pwd_discount_cents,
        ];
    }

    /**
     * The Phase 5 fields shared by `Order` and `OrderSummary` (after `order_no`, which
     * sits next to `invoice_no`). Needs the `reviewer` relation.
     *
     * @return array{source: string, needs_review: bool, review_reasons: list<string>, reviewed_at: string|null, reviewed_by: array{id: int, name: string}|null, synced_at: string|null}
     */
    public static function offlineFields(Order $order): array
    {
        return [
            'source' => $order->source,
            'needs_review' => $order->needs_review,
            'review_reasons' => array_values($order->review_reasons ?? []),
            'reviewed_at' => $order->reviewed_at?->toIso8601ZuluString(),
            'reviewed_by' => $order->reviewer === null
                ? null
                : ['id' => $order->reviewer->id, 'name' => $order->reviewer->name],
            'synced_at' => $order->synced_at?->toIso8601ZuluString(),
        ];
    }
}
