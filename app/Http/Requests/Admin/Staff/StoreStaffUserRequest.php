<?php

namespace App\Http\Requests\Admin\Staff;

use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/users
 */
class StoreStaffUserRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', User::class) ?? false;
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
        return [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['bail', 'required', 'string', 'email', 'max:255', StaffRules::uniqueEmail()],
            'password' => StaffRules::password(),
            'role_id' => StaffRules::roleId($this->caller()),
            'is_active' => ['sometimes', 'required', 'boolean'],
            'pin' => ['sometimes', ...StaffRules::pin()],
        ];
    }

    public function caller(): User
    {
        /** @var User */
        return $this->user();
    }
}
