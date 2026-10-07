<?php

namespace App\Http\Requests\Admin\Staff;

use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PUT /api/v1/admin/users/{user}/pin
 *
 * `pin` must be present: a PIN string sets it, `null` removes it.
 */
class SetStaffPinRequest extends FormRequest
{
    /**
     * Checked before validation: 403 without `user.manage` or for a target above the caller.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('setPin', $this->target()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'pin' => ['present', ...StaffRules::pin()],
        ];
    }

    public function target(): User
    {
        /** @var User */
        return $this->route('user');
    }

    /**
     * The new PIN, or null to remove it.
     */
    public function pin(): ?string
    {
        return $this->validated('pin');
    }
}
