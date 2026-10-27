<?php

namespace App\Http\Requests\Reservations;

use App\Exceptions\ConflictException;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\DineIn;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/reservations (Table Management → E.2; `sale.create`; idempotent:
 * `Idempotency-Key` = the body's `ulid`). `403` without `sale.create`, then `409` while
 * dine-in is off, then the field rules (ReservationRules). The clash check runs in
 * App\Actions\Reservations\CreateReservationAction, under the table's row lock.
 */
class StoreReservationRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    /**
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('create', TableReservation::class)) {
            return false;
        }

        DineIn::ensureEnabled($user);

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var User $user */
        $user = $this->user();

        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            ...ReservationRules::rules(store: true, branchId: (int) $user->branch_id),
        ];
    }
}
