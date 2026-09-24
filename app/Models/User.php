<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Sanctum\NewAccessToken;

#[Fillable(['branch_id', 'role_id', 'name', 'email', 'password', 'is_active'])]
#[Hidden(['password', 'pin_hash', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasApiTokens<PersonalAccessToken> */
    use HasApiTokens;

    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, SoftDeletes;

    /**
     * Memoised permission slugs for this instance (sorted, unique).
     *
     * @var list<string>|null
     */
    protected ?array $permissionSlugCache = null;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'last_login_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * @return BelongsTo<Role, $this>
     */
    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    /**
     * The permission slugs granted by the user's role, sorted A→Z with no duplicates.
     * Loads role.permissions once (if not already eager loaded) and memoises the result.
     *
     * @return list<string>
     */
    public function permissionSlugs(): array
    {
        if ($this->permissionSlugCache !== null) {
            return $this->permissionSlugCache;
        }

        $this->loadMissing('role.permissions');

        return $this->permissionSlugCache = $this->role?->permissions
            ->pluck('slug')
            ->unique()
            ->sort()
            ->values()
            ->all() ?? [];
    }

    public function hasPermission(string $slug): bool
    {
        return in_array($slug, $this->permissionSlugs(), true);
    }

    /**
     * Issue a new Sanctum token bound to the given device, in a single insert.
     */
    public function createDeviceToken(Device $device, DateTimeInterface $expiresAt, array $abilities = ['*']): NewAccessToken
    {
        $plainTextToken = $this->generateTokenString();

        /** @var PersonalAccessToken $token */
        $token = $this->tokens()->create([
            'name' => $device->code,
            'token' => hash('sha256', $plainTextToken),
            'abilities' => $abilities,
            'expires_at' => $expiresAt,
            'device_id' => $device->getKey(),
        ]);

        $token->setRelation('device', $device);

        return new NewAccessToken($token, $token->getKey().'|'.$plainTextToken);
    }
}
