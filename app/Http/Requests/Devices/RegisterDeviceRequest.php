<?php

namespace App\Http\Requests\Devices;

use App\Models\Device;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/devices/register (any authenticated user, Phase 5).
 */
class RegisterDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('register', Device::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            // Generated once per app install and kept in SecureStore.
            'install_id' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'name' => ['required', 'string', 'max:60'],
            'app_version' => ['sometimes', 'nullable', 'string', 'max:20'],
            // Web POS → C: tablets send nothing (`android`); web terminals send `web`.
            'platform' => ['sometimes', 'nullable', Rule::in(Device::PLATFORMS)],
        ];
    }
}
