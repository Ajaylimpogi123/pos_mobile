<?php

namespace App\Http\Requests\Admin\Staff;

use App\Models\User;
use App\Rules\AssignableRole;
use App\Rules\Pin;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\Rules\Unique;

/**
 * Field rules shared by the staff endpoints (contract: Staff & Customers, Phase 1b).
 */
final class StaffRules
{
    /**
     * Password policy for create and reset. There is no confirmation field.
     *
     * @return list<mixed>
     */
    public static function password(): array
    {
        return ['required', 'string', 'max:255', Password::min(10)->mixedCase()->numbers()];
    }

    /**
     * A PIN string (4–6 digits, not trivial), or null. A JSON integer fails `string`.
     *
     * @return list<mixed>
     */
    public static function pin(): array
    {
        return ['bail', 'nullable', 'string', new Pin];
    }

    /**
     * `role_id`: an existing role the caller may assign.
     *
     * @return list<mixed>
     */
    public static function roleId(User $caller): array
    {
        return ['bail', 'required', 'integer', Rule::exists('roles', 'id'), new AssignableRole($caller)];
    }

    /**
     * Unique among non-deleted users. Emails are lowercased before validation, and the
     * column's `_ci` collation makes the comparison case-insensitive regardless.
     */
    public static function uniqueEmail(?User $ignore = null): Unique
    {
        $rule = Rule::unique('users', 'email')->whereNull('deleted_at');

        return $ignore === null ? $rule : $rule->ignore($ignore->id);
    }

    /**
     * The email as it will be stored: lowercased and trimmed. Non-strings pass through
     * unchanged so the `string` / `email` rules report them.
     */
    public static function normalizeEmail(mixed $email): mixed
    {
        return is_string($email) ? mb_strtolower(trim($email)) : $email;
    }
}
