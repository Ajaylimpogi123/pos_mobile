<?php

namespace App\Policies;

use App\Models\TableReservation;
use App\Models\User;

/**
 * Reservations (Table Management → E): every mutation needs `sale.create`, on a reservation of
 * the caller's branch. The list is also readable with `report.view` (the Board, Q-051).
 */
class TableReservationPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermission('sale.create') || $user->hasPermission('report.view');
    }

    public function create(User $user): bool
    {
        return $user->hasPermission('sale.create');
    }

    public function update(User $user, TableReservation $reservation): bool
    {
        return $user->hasPermission('sale.create') && $reservation->branch_id === $user->branch_id;
    }
}
