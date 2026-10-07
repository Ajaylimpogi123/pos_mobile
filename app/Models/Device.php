<?php

namespace App\Models;

use Database\Factories\DeviceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A tablet running the app (PROJECT_MEMORY §8.5). Since Phase 5 the app registers
 * itself silently with its per-install `install_id` (POST /api/v1/devices/register);
 * the server assigns the `code` used in offline order numbers (`T01`, `T02`, …) and
 * binds the session's token to the device (`personal_access_tokens.device_id`).
 *
 * @property int $id
 * @property int $branch_id
 * @property string $code
 * @property string|null $install_id
 * @property string $name
 * @property string|null $app_version
 * @property bool $is_active
 */
#[Fillable(['branch_id', 'code', 'name', 'last_seen_at', 'app_version', 'is_active'])]
class Device extends Model
{
    /** @use HasFactory<DeviceFactory> */
    use HasFactory, SoftDeletes;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'last_seen_at' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    /**
     * The code of a registered device: `T` + its id padded to 2 digits (T01, T02, … T123).
     */
    public static function codeFor(int $id): string
    {
        return sprintf('T%02d', $id);
    }

    /**
     * The device the user's current token is bound to, when it still exists (not
     * soft-deleted) and belongs to the user's branch; otherwise null.
     */
    public static function ofSession(User $user): ?self
    {
        $token = $user->currentAccessToken();

        if (! $token instanceof PersonalAccessToken || $token->device_id === null) {
            return null;
        }

        $device = self::query()->find($token->device_id);

        return $device !== null && $device->branch_id === (int) $user->branch_id ? $device : null;
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
