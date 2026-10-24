<?php

namespace App\Models;

use App\Support\Sales\Discount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An order line with the product snapshot taken at sale time. `unit_cost_cents` is
 * stored for costing but never returned by the API.
 *
 * @property int $id
 * @property int $order_id
 * @property int|null $tab_item_id The tab line this line settled (Dine-in Tables & Tabs), or null
 * @property int $product_id
 * @property int $category_id The product's category at the time of sale (Phase 4)
 * @property string $product_name
 * @property string $category_name
 * @property string|null $sku
 * @property int $unit_price_cents
 * @property int $unit_cost_cents
 * @property bool $is_vatable
 * @property string $qty Decimal string, whole units in Phase 3
 * @property int $gross_cents
 * @property string $discount_type
 * @property string|null $discount_kind
 * @property int|null $discount_value
 * @property int $line_discount_cents
 * @property int $order_discount_share_cents
 * @property int $line_total_cents
 * @property bool $is_sc_pwd SC/PWD: marked, or given an eligible share in `headcount` mode
 * @property int $sc_pwd_eligible_cents `E_i`
 * @property int $sc_pwd_vat_relief_cents `R_i`
 * @property int $sc_pwd_discount_cents `S_i`
 * @property string $refunded_qty Decimal string: the units refunded so far (Phase 7)
 * @property int $refunded_cents The amount refunded so far (Phase 7)
 * @property string|null $notes
 */
class OrderItem extends Model
{
    /**
     * Defaults of a new line (the same as the columns' defaults).
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'refunded_qty' => 0,
        'refunded_cents' => 0,
        'is_sc_pwd' => false,
        'sc_pwd_eligible_cents' => 0,
        'sc_pwd_vat_relief_cents' => 0,
        'sc_pwd_discount_cents' => 0,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'order_id' => 'integer',
            'tab_item_id' => 'integer',
            'product_id' => 'integer',
            'category_id' => 'integer',
            'unit_price_cents' => 'integer',
            'unit_cost_cents' => 'integer',
            'is_vatable' => 'boolean',
            'qty' => 'decimal:4',
            'gross_cents' => 'integer',
            'discount_value' => 'integer',
            'line_discount_cents' => 'integer',
            'order_discount_share_cents' => 'integer',
            'line_total_cents' => 'integer',
            'is_sc_pwd' => 'boolean',
            'sc_pwd_eligible_cents' => 'integer',
            'sc_pwd_vat_relief_cents' => 'integer',
            'sc_pwd_discount_cents' => 'integer',
            'refunded_qty' => 'decimal:4',
            'refunded_cents' => 'integer',
        ];
    }

    /**
     * The quantity sold, in whole units.
     */
    public function wholeQty(): int
    {
        return (int) $this->qty;
    }

    /**
     * The units refunded so far, in whole units (Phase 7).
     */
    public function wholeRefundedQty(): int
    {
        return (int) $this->refunded_qty;
    }

    /**
     * The units still refundable (Phase 7).
     */
    public function refundableQty(): int
    {
        return $this->wholeQty() - $this->wholeRefundedQty();
    }

    /**
     * The line's VAT-exempt SC/PWD part `X_i` (SC/PWD contract, step E): `E_i − R_i − S_i`
     * when the order's SC/PWD is VAT exempt, else 0.
     */
    public function scPwdExemptCents(bool $orderIsVatExempt): int
    {
        return $orderIsVatExempt
            ? $this->sc_pwd_eligible_cents - $this->sc_pwd_vat_relief_cents - $this->sc_pwd_discount_cents
            : 0;
    }

    /**
     * The line discount as sent (`{type, kind, value}`), or null.
     */
    public function lineDiscount(): ?Discount
    {
        if ($this->discount_type === Order::NO_DISCOUNT || $this->discount_kind === null || $this->discount_value === null) {
            return null;
        }

        return new Discount($this->discount_type, $this->discount_kind, $this->discount_value);
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }
}
