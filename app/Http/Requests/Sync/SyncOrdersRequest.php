<?php

namespace App\Http\Requests\Sync;

use App\Exceptions\ConflictException;
use App\Models\Device;
use App\Models\Order;
use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/sync/orders (permission `sale.create`, Phase 5).
 *
 * Checked in this order: 403 without `sale.create`; 409 when the caller's token is not
 * bound to a device of their branch (`Register this tablet first.`); then the envelope
 * (`orders`: 1–50), the only thing that fails the whole request with a 422. Each order is
 * validated on its own by the ingest (OfflineOrderRules).
 */
class SyncOrdersRequest extends FormRequest
{
    public const MAX_ORDERS = 50;

    public const MESSAGE_NO_DEVICE = 'Register this tablet first.';

    private ?Device $device = null;

    /**
     * @throws ConflictException 409 when the token has no device
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('create', Order::class)) {
            return false;
        }

        $this->device = Device::ofSession($user);

        if ($this->device === null) {
            throw new ConflictException(self::MESSAGE_NO_DEVICE);
        }

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'orders' => ['required', 'array', 'min:1', 'max:'.self::MAX_ORDERS],
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
