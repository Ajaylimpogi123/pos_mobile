<?php

namespace App\Models;

use App\Support\Sales\Discount;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * A completed sale (Phase 3). Written only through App\Actions\Sales\RecordOrder, in one
 * transaction with its lines, payments and stock movements: online by CompleteSaleAction,
 * offline (Phase 5) by App\Actions\Sync\IngestOfflineOrderAction. Orders are never deleted.
 * Since Phase 6 each order carries the ULID of its shift (App\Models\Shift), linked by ULID.
 * Phase 7: a completed sale can be voided (App\Actions\Sales\VoidOrderAction) or refunded,
 * in full or line by line (App\Actions\Sales\RefundOrderAction, App\Models\Refund):
 * `completed → voided`, `completed | partially_refunded → partially_refunded | refunded`.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int|null $device_id The tablet that recorded the sale (Phase 5)
 * @property string|null $shift_ulid The shift the sale was rung up in (Phase 6; null before). No foreign key.
 * @property int $user_id
 * @property int|null $customer_id
 * @property int|null $authorized_by
 * @property string $invoice_no
 * @property string|null $order_no The device number of an offline sale (Phase 5)
 * @property int $queue_no
 * @property string $items_qty Σ qty of the lines (decimal string; Phase 6, for the sales reports)
 * @property string|null $table_no Free label typed by the cashier (Core Sale revision 2)
 * @property int|null $tab_id The tab this order settled (Dine-in Tables & Tabs); null for pay-now sales
 * @property int $service_charge_cents The service charge `S` (Dine-in), part of `total_cents`
 * @property bool $service_charge_waived Dine-in: the settlement waived the service charge
 * @property int|null $split_count Dine-in: the equal-split share count (2–10), or null
 * @property string $business_date
 * @property string $status
 * @property string $source `online` or `offline` (Phase 5)
 * @property int $subtotal_cents
 * @property int $line_discounts_cents
 * @property string $discount_type
 * @property string|null $discount_kind
 * @property int|null $discount_value
 * @property int $order_discount_cents
 * @property string|null $sc_pwd_mode SC/PWD `items` or `headcount`; null without SC/PWD
 * @property int|null $sc_pwd_diners SC/PWD `headcount` mode only
 * @property bool $sc_pwd_vat_exempt
 * @property list<array{type: string, id_no: string}>|null $sc_pwd_persons
 * @property int $sc_pwd_vat_relief_cents `R`, part of `discount_cents`
 * @property int $sc_pwd_discount_cents `S`, part of `discount_cents`
 * @property int $discount_cents
 * @property int $total_cents
 * @property int $refunded_cents Σ of the order's refunds (Phase 7)
 * @property int $vatable_sales_cents
 * @property int $vat_amount_cents
 * @property int $vat_exempt_sales_cents
 * @property int $tendered_cents
 * @property int $change_cents
 * @property int $client_total_cents
 * @property bool $has_total_mismatch
 * @property bool $needs_review
 * @property list<string> $review_reasons The REVIEW_* flags, in their fixed order
 * @property CarbonInterface|null $reviewed_at
 * @property int|null $reviewed_by
 * @property string|null $notes
 * @property CarbonInterface $placed_at
 * @property CarbonInterface|null $synced_at When an offline sale reached the server
 * @property CarbonInterface|null $voided_at (Phase 7)
 * @property int|null $voided_by The user who made the void request (Phase 7)
 * @property string|null $void_reason (Phase 7)
 * @property int|null $void_authorized_by The approver when a manager PIN was used (Phase 7)
 */
class Order extends Model
{
    public const STATUS_COMPLETED = 'completed';

    /**
     * Phase 7: voided while its shift was open. A voided order leaves every sales figure.
     */
    public const STATUS_VOIDED = 'voided';

    /**
     * Phase 7: every line's full quantity has been refunded.
     */
    public const STATUS_REFUNDED = 'refunded';

    /**
     * Phase 7: some, but not all, of the lines' quantities have been refunded.
     */
    public const STATUS_PARTIALLY_REFUNDED = 'partially_refunded';

    /**
     * Every status (the `GET /orders` filter).
     */
    public const STATUSES = [self::STATUS_COMPLETED, self::STATUS_VOIDED, self::STATUS_REFUNDED, self::STATUS_PARTIALLY_REFUNDED];

    /**
     * `discount_type` of an order without an order discount.
     */
    public const NO_DISCOUNT = 'none';

    public const SOURCE_ONLINE = 'online';

    public const SOURCE_OFFLINE = 'offline';

    /**
     * Review flags of a synced offline sale (Phase 5), listed in the order they are stored.
     */
    public const REVIEW_PRICE_CHANGED = 'price_changed';

    public const REVIEW_OVERSOLD = 'oversold';

    public const REVIEW_TOTAL_MISMATCH = 'total_mismatch';

    public const REVIEW_PAYMENT_SHORT = 'payment_short';

    public const REVIEW_DISCOUNT_OVER_LIMIT = 'discount_over_limit';

    public const REVIEW_CLOCK_SKEW = 'clock_skew';

    /**
     * Phase 6: the order's shift is known and was closed before the order's `placed_at`.
     */
    public const REVIEW_SHIFT_CLOSED = 'shift_closed';

    /**
     * Defaults of a new order (the same as the columns' defaults).
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'source' => self::SOURCE_ONLINE,
        'needs_review' => false,
        'review_reasons' => '[]',
        'refunded_cents' => 0,
        'sc_pwd_vat_exempt' => false,
        'sc_pwd_vat_relief_cents' => 0,
        'sc_pwd_discount_cents' => 0,
        'service_charge_cents' => 0,
        'service_charge_waived' => false,
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Orders are never deleted.'));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'device_id' => 'integer',
            'user_id' => 'integer',
            'customer_id' => 'integer',
            'authorized_by' => 'integer',
            'queue_no' => 'integer',
            'tab_id' => 'integer',
            'service_charge_cents' => 'integer',
            'service_charge_waived' => 'boolean',
            'split_count' => 'integer',
            'subtotal_cents' => 'integer',
            'line_discounts_cents' => 'integer',
            'discount_value' => 'integer',
            'order_discount_cents' => 'integer',
            'sc_pwd_diners' => 'integer',
            'sc_pwd_vat_exempt' => 'boolean',
            'sc_pwd_persons' => 'array',
            'sc_pwd_vat_relief_cents' => 'integer',
            'sc_pwd_discount_cents' => 'integer',
            'discount_cents' => 'integer',
            'total_cents' => 'integer',
            'refunded_cents' => 'integer',
            'vatable_sales_cents' => 'integer',
            'vat_amount_cents' => 'integer',
            'vat_exempt_sales_cents' => 'integer',
            'tendered_cents' => 'integer',
            'change_cents' => 'integer',
            'client_total_cents' => 'integer',
            'has_total_mismatch' => 'boolean',
            'needs_review' => 'boolean',
            'review_reasons' => 'array',
            'reviewed_at' => 'datetime',
            'reviewed_by' => 'integer',
            'placed_at' => 'datetime',
            'synced_at' => 'datetime',
            'voided_at' => 'datetime',
            'voided_by' => 'integer',
            'void_authorized_by' => 'integer',
        ];
    }

    /**
     * The order discount as sent (`{type, kind, value}`), or null.
     */
    public function orderDiscount(): ?Discount
    {
        if ($this->discount_type === self::NO_DISCOUNT || $this->discount_kind === null || $this->discount_value === null) {
            return null;
        }

        return new Discount($this->discount_type, $this->discount_kind, $this->discount_value);
    }

    /**
     * Whether the sale carries a Senior Citizen / PWD discount.
     */
    public function hasScPwd(): bool
    {
        return $this->sc_pwd_mode !== null;
    }

    /**
     * Orders the user may see (Phase 3 contract, *Visibility*): the user's branch only;
     * all of it with `report.view`, otherwise only the orders the user rang up.
     *
     * @param  Builder<Order>  $query
     */
    #[Scope]
    protected function visibleTo(Builder $query, User $user): void
    {
        $query->where('orders.branch_id', $user->branch_id)
            ->when(! $user->hasPermission('report.view'), fn (Builder $q) => $q->where('orders.user_id', $user->id));
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class)->withTrashed();
    }

    /**
     * The user who completed the sale (soft-deleted users included).
     *
     * @return BelongsTo<User, $this>
     */
    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    /**
     * The discount approver (`authorized_by`), when approval was needed.
     *
     * @return BelongsTo<User, $this>
     */
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'authorized_by')->withTrashed();
    }

    /**
     * The manager who marked the order reviewed (Phase 5), soft-deleted users included.
     *
     * @return BelongsTo<User, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by')->withTrashed();
    }

    /**
     * The user who made the void request (Phase 7), soft-deleted users included.
     *
     * @return BelongsTo<User, $this>
     */
    public function voider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'voided_by')->withTrashed();
    }

    /**
     * The manager who approved the void with their PIN (Phase 7), soft-deleted included.
     *
     * @return BelongsTo<User, $this>
     */
    public function voidAuthorizer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'void_authorized_by')->withTrashed();
    }

    /**
     * The tablet that recorded the sale (Phase 5), soft-deleted included.
     *
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class)->withTrashed();
    }

    /**
     * The tab this order settled (Dine-in Tables & Tabs), or null.
     *
     * @return BelongsTo<Tab, $this>
     */
    public function tab(): BelongsTo
    {
        return $this->belongsTo(Tab::class);
    }

    /**
     * The current customer record (no name snapshot is stored), soft-deleted included.
     *
     * @return BelongsTo<Customer, $this>
     */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class)->withTrashed();
    }

    /**
     * The lines, in the order sent.
     *
     * @return HasMany<OrderItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class)->orderBy('id');
    }

    /**
     * The payments, in the order sent.
     *
     * @return HasMany<Payment, $this>
     */
    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class)->orderBy('id');
    }

    /**
     * The refunds (Phase 7), oldest first.
     *
     * @return HasMany<Refund, $this>
     */
    public function refunds(): HasMany
    {
        return $this->hasMany(Refund::class)->orderBy('id');
    }
}
