<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One occurrence of an error group (Hardening & Pilot → B). `ulid` is the client's
 * idempotency key; server occurrences get a server-generated one. Never holds request
 * bodies, headers, tokens, PINs or passwords.
 *
 * @property int $id
 * @property string $ulid
 * @property int $error_group_id
 * @property int|null $branch_id
 * @property int|null $user_id
 * @property int|null $device_id
 * @property Carbon $occurred_at
 * @property Carbon $received_at
 * @property string $message
 * @property string|null $stack
 * @property array<string, mixed>|null $context
 */
class ErrorEvent extends Model
{
    public $timestamps = false;

    protected $guarded = ['id'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'error_group_id' => 'integer',
            'branch_id' => 'integer',
            'user_id' => 'integer',
            'device_id' => 'integer',
            'occurred_at' => 'datetime',
            'received_at' => 'datetime',
            'context' => 'array',
        ];
    }

    /**
     * @return BelongsTo<ErrorGroup, $this>
     */
    public function group(): BelongsTo
    {
        return $this->belongsTo(ErrorGroup::class, 'error_group_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class)->withTrashed();
    }
}
