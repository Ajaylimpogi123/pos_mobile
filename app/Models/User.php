<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;
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
     * The name given to every token issued by POST /api/v1/auth/login.
     */
    public const API_TOKEN_NAME = 'mobile-app';

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
            'branch_id' => 'integer',
            'role_id' => 'integer',
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'last_login_at' => 'datetime',
        ];
    }

    /**
     * Emails are stored lowercased and trimmed (on create and on update).
     *
     * @return Attribute<string|null, string|null>
     */
    protected function email(): Attribute
    {
        return Attribute::make(
            set: fn (?string $value) => $value === null ? null : Str::lower(trim($value)),
        );
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
     * The role hierarchy ("you can't grant what you don't have"): this user may
     * view, edit, reset, deactivate or delete the target only if the target's role
     * grants no permission this user lacks. Always true for the user's own record
     * (the self-protection rules are enforced separately).
     */
    public function canManage(User $target): bool
    {
        $role = $target->role;

        return $role !== null && $role->isGrantableBy($this);
    }

    /**
     * Whether a quick-switch PIN is set.
     */
    public function hasPin(): bool
    {
        return $this->pin_hash !== null;
    }

    /**
     * Revoke the user's API tokens, optionally keeping one (e.g. the caller's current
     * token). Returns the number of tokens revoked.
     */
    public function revokeApiTokens(?int $exceptTokenId = null): int
    {
        return $this->tokens()
            ->when($exceptTokenId !== null, fn ($query) => $query->whereKeyNot($exceptTokenId))
            ->delete();
    }

    /**
     * Issue a new Sanctum API token for the mobile app (not bound to a device;
     * `device_id` stays null). Other tokens the user holds are left alone.
     *
     * @param  list<string>  $abilities
     */
    public function createApiToken(DateTimeInterface $expiresAt, array $abilities = ['*']): NewAccessToken
    {
        return $this->createToken(self::API_TOKEN_NAME, $abilities, $expiresAt);
    }
}
