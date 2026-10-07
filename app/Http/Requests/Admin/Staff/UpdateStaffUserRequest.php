<?php

namespace App\Http\Requests\Admin\Staff;

use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/users/{user}
 *
 * Partial update of `name`, `email`, `role_id` and `is_active` (none nullable).
 * `password` and `pin` are not accepted here: they have no rule, so they never
 * reach validated() and are ignored.
 */
class UpdateStaffUserRequest extends FormRequest
{
    /**
     * Checked before validation: 403 without `user.manage` or for a target above the caller.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->target()) ?? false;
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('email')) {
            $this->merge(['email' => StaffRules::normalizeEmail($this->input('email'))]);
        }
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var User $caller */
        $caller = $this->user();

        return [
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            'email' => ['bail', 'sometimes', 'required', 'string', 'email', 'max:255', StaffRules::uniqueEmail($this->target())],
            'role_id' => ['sometimes', ...StaffRules::roleId($caller)],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }

    public function target(): User
    {
        /** @var User */
        return $this->route('user');
    }
}
