<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * The cancellation of a quantity already sent to the kitchen (Dine-in Tables & Tabs →
 * D.5). `ulid` is the request's Idempotency-Key. `authorized_by` is the manager who
 * approved it with a PIN, or null when the caller had `sale.void`.
 *
 * @property int $id
 * @property string $ulid
 * @property int $tab_item_id
 * @property int $qty
 * @property string $reason
 * @property int $cancelled_by
 * @property int|null $authorized_by
 * @property CarbonInterface|null $created_at
 */
class TabItemCancellation extends Model
{
    public const UPDATED_AT = null;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'tab_item_id' => 'integer',
            'qty' => 'integer',
            'cancelled_by' => 'integer',
            'authorized_by' => 'integer',
        ];
    }
}
