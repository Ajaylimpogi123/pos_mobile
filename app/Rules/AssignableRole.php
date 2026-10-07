<?php

namespace App\Rules;

use App\Models\Role;
use App\Models\User;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The role hierarchy applied to `role_id`: the caller may only assign a role whose
 * permissions are all among the caller's own (Role::isGrantableBy). Run it after
 * `integer` and `exists` (with `bail`).
 */
class AssignableRole implements ValidationRule
{
    public const MESSAGE = 'You cannot assign this role.';

    public function __construct(private readonly User $caller) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $role = Role::query()->with('permissions')->find($value);

        if ($role === null || ! $role->isGrantableBy($this->caller)) {
            $fail(self::MESSAGE);
        }
    }
}
