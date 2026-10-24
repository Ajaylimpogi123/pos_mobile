<?php

namespace App\Models;

use Database\Factories\DeviceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

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
 * @property string $platform
 * @property string $name
 * @property string|null $app_version
 * @property bool $is_active
 * @property Carbon|null $last_seen_at
 * @property Carbon|null $retired_at
 * @property array<string, mixed>|null $last_heartbeat
 * @property Carbon|null $last_heartbeat_at
 * @property int|null $last_user_id
 */
#[Fillable(['branch_id', 'code', 'name', 'last_seen_at', 'app_version', 'is_active'])]
class Device extends Model
{
    /** @use HasFactory<DeviceFactory> */
    use HasFactory, SoftDeletes;

    public const PLATFORM_ANDROID = 'android';

    public const PLATFORM_WEB = 'web';

    public const PLATFORMS = [self::PLATFORM_ANDROID, self::PLATFORM_WEB];

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'platform' => self::PLATFORM_ANDROID,
    ];

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
            // Hardening & Pilot (Phase 8) → C
            'retired_at' => 'datetime',
            'last_heartbeat' => 'array',
            'last_heartbeat_at' => 'datetime',
            'last_user_id' => 'integer',
        ];
    }

    /**
     * The code of a registered device: `T` (a tablet) or `W` (a web terminal, Web POS → C)
     * + its id padded to 2 digits (T01, T02, … T123; W03).
     */
    public static function codeFor(int $id, string $platform = self::PLATFORM_ANDROID): string
    {
        return sprintf($platform === self::PLATFORM_WEB ? 'W%02d' : 'T%02d', $id);
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
     * Retired (Hardening & Pilot → C): `is_active = false`.
     */
    public function isRetired(): bool
    {
        return ! $this->is_active;
    }

    /**
     * The user signed in at the last heartbeat (Hardening & Pilot → C).
     *
     * @return BelongsTo<User, $this>
     */
    public function lastUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'last_user_id')->withTrashed();
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
