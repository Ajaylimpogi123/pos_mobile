<?php

namespace App\Http\Requests\Reservations;

use App\Exceptions\ConflictException;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\DineIn;
use Illuminate\Foundation\Http\FormRequest;
use LogicException;

/**
 * The endpoints of `/api/v1/reservations/{ulid}` (Table Management → E; `sale.create`; every
 * one idempotent, the `idempotent` middleware replays before this runs). Checked in order:
 *
 * 1. `403` without `sale.create`;
 * 2. `409 "Dine-in tables are turned off in Settings."` while dine-in is off;
 * 3. `404` when the reservation doesn't exist or belongs to another branch;
 * 4. the field rules (`422`), with the `Idempotency-Key` header as `idempotency_key`.
 *
 * Whether it is still `booked` (`409`) is checked by the action, under its row lock.
 */
abstract class ReservationRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    private ?TableReservation $reservation = null;

    /**
     * Steps 1–3.
     *
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('create', TableReservation::class)) {
            return false;
        }

        DineIn::ensureEnabled($user);

        $this->reservation = TableReservation::query()
            ->where('branch_id', $user->branch_id)
            ->where('ulid', strtoupper((string) $this->route('ulid')))
            ->firstOrFail();

        return $user->can('update', $this->reservation);
    }

    /**
     * The reservation of the `{ulid}` route.
     */
    public function reservation(): TableReservation
    {
        return $this->reservation ?? throw new LogicException('The reservation is resolved by authorize().');
    }

    public function actor(): User
    {
        /** @var User */
        return $this->user();
    }
}
