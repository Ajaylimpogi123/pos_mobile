<?php

namespace App\Http\Requests\Admin\Staff;

use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/users/{user}/password
 */
class ResetStaffPasswordRequest extends FormRequest
{
    /**
     * Checked before validation: 403 without `user.manage` or for a target above the caller.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('resetPassword', $this->target()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'password' => StaffRules::password(),
        ];
    }

    public function target(): User
    {
        /** @var User */
        return $this->route('user');
    }
}
