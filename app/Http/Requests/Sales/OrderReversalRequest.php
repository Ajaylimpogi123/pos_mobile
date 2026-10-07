<?php

namespace App\Http\Requests\Sales;

use App\Exceptions\ConflictException;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Http\Requests\Sync\SyncOrdersRequest;
use App\Models\Device;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use LogicException;

/**
 * The reversals of a sale (Phase 7): POST /orders/{ulid}/void and POST /orders/{ulid}/refunds.
 * Both are idempotent (the `idempotent` middleware replays before this runs) and checked in
 * this order:
 *
 * 1. `403` without the permission (`sale.create`, or `sale.void` / `sale.refund`);
 * 2. `409 "Register this tablet first."` when the token isn't bound to a device of the
 *    caller's branch (as the shift writes);
 * 3. `404` when the order isn't visible to the caller (as GET /orders/{ulid});
 * 4. the field rules (`422`), with the `Idempotency-Key` header as `idempotency_key`.
 *
 * `authorization` (`{ user_id, pin }`, nullable) carries a manager's PIN approval when the
 * caller lacks `sale.void` / `sale.refund` (App\Actions\Sales\ApproveReversal).
 */
abstract class OrderReversalRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    private ?Device $device = null;

    private ?Order $order = null;

    /**
     * Steps 1–3.
     *
     * @param  'void'|'refund'  $ability  The OrderPolicy ability
     *
     * @throws ConflictException 409 without a device
     */
    protected function authorizeReversal(string $ability): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can($ability, Order::class)) {
            return false;
        }

        $this->device = Device::ofSession($user) ?? throw new ConflictException(SyncOrdersRequest::MESSAGE_NO_DEVICE);

        $this->order = Order::query()
            ->visibleTo($user)
            ->where('ulid', strtoupper((string) $this->route('ulid')))
            ->firstOrFail();

        return true;
    }

    /**
     * The device the caller's token is bound to.
     */
    public function device(): Device
    {
        return $this->device ?? throw new LogicException('The device is resolved by authorize().');
    }

    /**
     * The order of the `{ulid}` route.
     */
    public function order(): Order
    {
        return $this->order ?? throw new LogicException('The order is resolved by authorize().');
    }

    /**
     * `authorization`: nullable; when sent, `user_id` (integer) and `pin` (4–6 digits).
     *
     * @return array<string, list<string>>
     */
    protected static function authorizationRules(): array
    {
        return [
            'authorization' => ['sometimes', 'nullable', 'array', 'required_array_keys:user_id,pin'],
            'authorization.user_id' => ['sometimes', 'required', 'integer'],
            'authorization.pin' => ['sometimes', 'required', 'string', 'regex:/^\d{4,6}$/D'],
        ];
    }
}
