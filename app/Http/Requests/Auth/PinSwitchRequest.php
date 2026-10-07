<?php

namespace App\Http\Requests\Auth;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/auth/pin (any authenticated user: the device's current session).
 *
 * PIN **entry** is only checked for shape (4–6 digits, as a string); the strength rules
 * (App\Rules\Pin) apply only when a PIN is set.
 */
class PinSwitchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'user_id' => ['required', 'integer'],
            'pin' => ['required', 'string', 'regex:/^\d{4,6}$/D'],
        ];
    }
}
