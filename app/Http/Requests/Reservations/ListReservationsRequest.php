<?php

namespace App\Http\Requests\Reservations;

use App\Exceptions\ConflictException;
use App\Http\Requests\CursorListRequest;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\DineIn;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/reservations (Table Management → E.1; `sale.create` or `report.view`, Q-051;
 * `per_page` 1–100, default 100). `403` without either, then `409` while dine-in is off. Filters: `date` (a
 * business day, default today), `status` and `table_id`.
 */
class ListReservationsRequest extends CursorListRequest
{
    public const DEFAULT_PER_PAGE = 100;

    /**
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('viewAny', TableReservation::class)) {
            return false;
        }

        DineIn::ensureEnabled($user);

        return true;
    }

    protected function filterRules(): array
    {
        return [
            'date' => ['sometimes', 'date_format:Y-m-d'],
            'status' => ['sometimes', Rule::in(TableReservation::STATUSES)],
            'table_id' => ['sometimes', 'integer'],
        ];
    }

    /**
     * The `date` filter, or null when it was not sent.
     */
    public function businessDate(): ?string
    {
        $date = $this->validated('date');

        return $date === null ? null : (string) $date;
    }

    public function status(): ?string
    {
        $status = $this->validated('status');

        return $status === null ? null : (string) $status;
    }
}
