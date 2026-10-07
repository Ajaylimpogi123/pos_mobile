<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Laravel\Sanctum\PersonalAccessToken as SanctumPersonalAccessToken;

/**
 * Sanctum token model with a nullable `device_id`. Since Auth revision 2, login does
 * not bind tokens to a device. Since Phase 5, POST /api/v1/devices/register binds the
 * calling token to the app's device (App\Actions\Devices\RegisterDeviceAction); online
 * sales record it and offline sync requires it.
 *
 * @property int|null $device_id
 */
class PersonalAccessToken extends SanctumPersonalAccessToken
{
    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'token',
        'abilities',
        'expires_at',
        'device_id',
    ];

    /**
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
