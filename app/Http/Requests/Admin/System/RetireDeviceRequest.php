<?php

namespace App\Http\Requests\Admin\System;

use App\Models\Device;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/devices/{id}/retire (Hardening & Pilot → C; `system.manage`):
 * `{ confirm?: bool }`; `true` retires even with unsynced sales.
 */
class RetireDeviceRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('retire', $this->device()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'confirm' => ['sometimes', 'nullable', 'boolean'],
        ];
    }

    public function confirmed(): bool
    {
        return (bool) $this->validated('confirm', false);
    }

    public function device(): Device
    {
        /** @var Device */
        return $this->route('device');
    }
}
