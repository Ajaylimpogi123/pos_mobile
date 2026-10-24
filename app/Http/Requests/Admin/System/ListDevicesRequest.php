<?php

namespace App\Http\Requests\Admin\System;

use App\Http\Requests\CursorListRequest;
use App\Models\Device;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/admin/devices (Hardening & Pilot → C; `system.manage`): `status`
 * (`active|retired|all`, default `active`), `platform` (`android|web`) and `search` (code or
 * name).
 */
class ListDevicesRequest extends CursorListRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Device::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(['active', 'retired', 'all'])],
            'platform' => ['sometimes', 'string', Rule::in(Device::PLATFORMS)],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ];
    }

    public function status(): string
    {
        return (string) $this->validated('status', 'active');
    }

    public function platform(): ?string
    {
        $value = $this->validated('platform');

        return $value === null ? null : (string) $value;
    }
}
