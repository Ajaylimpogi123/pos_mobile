<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One tender of an order. `amount_cents` is its contribution to the total (cash: the
 * amount handed over minus the change), so Σ amount_cents = the order's total_cents.
 *
 * @property int $id
 * @property int $order_id
 * @property string $method `cash` or `gcash`
 * @property int $amount_cents
 * @property int|null $tendered_cents
 * @property int $change_cents
 * @property string|null $reference_no
 */
class Payment extends Model
{
    public const METHOD_CASH = 'cash';

    public const METHOD_GCASH = 'gcash';

    /**
     * Every method, in the order the dashboard lists them.
     */
    public const METHODS = [self::METHOD_CASH, self::METHOD_GCASH];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'order_id' => 'integer',
            'amount_cents' => 'integer',
            'tendered_cents' => 'integer',
            'change_cents' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Order, $this>
     */
    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
