<?php

namespace App\Actions\Staff;

use App\Actions\Audit\RecordAuditLog;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Sets (hashed into `pin_hash`) or removes (`null`) a user's quick-switch PIN and
 * writes a `user.pin_set` / `user.pin_removed` audit entry, never with the PIN.
 * Removing a PIN that is not set changes nothing and writes nothing.
 */
class SetStaffPinAction
{
    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    public function execute(User $target, ?string $pin, User $actor, ?string $ip = null): User
    {
        if ($pin === null && ! $target->hasPin()) {
            return $target;
        }

        return DB::transaction(function () use ($target, $pin, $actor, $ip): User {
            $target->forceFill([
                'pin_hash' => $pin === null ? null : Hash::make($pin),
                'updated_by' => $actor->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: $pin === null ? 'user.pin_removed' : 'user.pin_set',
                actor: $actor,
                subject: $target,
                ip: $ip,
            );

            return $target;
        });
    }
}
