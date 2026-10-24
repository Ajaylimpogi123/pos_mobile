<?php

namespace App\Http\Requests\Devices;

use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/devices/heartbeat (Hardening & Pilot → C; any authenticated user).
 *
 * Checked in this order: 409 `Register this tablet first.` when the caller's token is not
 * bound to a device of their branch; then the body (only `app_version` is required).
 */
class HeartbeatRequest extends FormRequest
{
    public const MESSAGE_NO_DEVICE = 'Register this tablet first.';

    public const MAX_PRINTERS = 20;

    private ?Device $device = null;

    /**
     * @throws ConflictException 409 when the token has no device
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('heartbeat', Device::class)) {
            return false;
        }

        $this->device = Device::ofSession($user) ?? throw new ConflictException(self::MESSAGE_NO_DEVICE);

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'app_version' => ['required', 'string', 'max:20'],
            'os_version' => ['sometimes', 'nullable', 'string', 'max:20'],
            'device_model' => ['sometimes', 'nullable', 'string', 'max:60'],
            'outbox_pending' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'outbox_failed' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'oldest_pending_at' => ['sometimes', 'nullable', 'date'],
            'errors_pending' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'last_catalogue_sync_at' => ['sometimes', 'nullable', 'date'],
            'last_stock_sync_at' => ['sometimes', 'nullable', 'date'],
            'storage_free_mb' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'printers' => ['sometimes', 'nullable', 'array', 'list', 'max:'.self::MAX_PRINTERS],
            'printers.*.id' => ['required', 'integer'],
            'printers.*.ok' => ['required', 'boolean'],
            'printers.*.checked_at' => ['required', 'date'],
        ];
    }

    /**
     * The device the caller's token is bound to.
     */
    public function device(): Device
    {
        return $this->device ??= Device::ofSession($this->user())
            ?? throw new ConflictException(self::MESSAGE_NO_DEVICE);
    }
}
