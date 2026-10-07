<?php

namespace App\Models;

use Database\Factories\RoleFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'max_discount_percent', 'is_admin'])]
class Role extends Model
{
    /** @use HasFactory<RoleFactory> */
    use HasFactory;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'max_discount_percent' => 'integer',
            'is_admin' => 'boolean',
        ];
    }

    /**
     * @return BelongsToMany<Permission, $this>
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class)->withTimestamps();
    }

    /**
     * The role's permission slugs, sorted A→Z with no duplicates.
     *
     * @return list<string>
     */
    public function permissionSlugs(): array
    {
        $this->loadMissing('permissions');

        return $this->permissions->pluck('slug')->unique()->sort()->values()->all();
    }

    /**
     * The role hierarchy ("you can't grant what you don't have"), in one place:
     * the caller may assign this role, or act on a user holding it, only if every
     * permission of this role is also one of the caller's own permissions.
     */
    public function isGrantableBy(User $caller): bool
    {
        return array_diff($this->permissionSlugs(), $caller->permissionSlugs()) === [];
    }

    /**
     * @return HasMany<User, $this>
     */
    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}
