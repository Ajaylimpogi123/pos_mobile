<?php

namespace App\Http\Requests\Admin\System;

use App\Models\Device;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/devices/{id} (Hardening & Pilot → C; `system.manage`): `{ name }`
 * (max 60). Partial: an omitted name stays as it is; it can't be null.
 */
class UpdateDeviceRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->device()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:60'],
        ];
    }

    public function device(): Device
    {
        /** @var Device */
        return $this->route('device');
    }
}
