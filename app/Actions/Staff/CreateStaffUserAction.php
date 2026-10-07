<?php

namespace App\Actions\Staff;

use App\Actions\Audit\RecordAuditLog;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Creates a staff account in the caller's branch and writes a `user.created` audit
 * entry (plus `user.pin_set` when a PIN is given). The password and PIN are hashed
 * and never written to the audit trail.
 */
class CreateStaffUserAction
{
    public const AUDITED_FIELDS = ['name', 'email', 'role_id', 'is_active', 'branch_id'];

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input
     */
    public function execute(array $attributes, User $actor, ?string $ip = null): User
    {
        return DB::transaction(function () use ($attributes, $actor, $ip): User {
            $pin = $attributes['pin'] ?? null;

            $user = new User;
            $user->fill([
                'name' => $attributes['name'],
                'email' => $attributes['email'],
                'password' => $attributes['password'],
                'role_id' => $attributes['role_id'],
                'is_active' => $attributes['is_active'] ?? true,
            ]);
            $user->forceFill([
                // Never from input: staff are always created in the caller's branch.
                'branch_id' => $actor->branch_id,
                'pin_hash' => $pin === null ? null : Hash::make($pin),
                'last_login_at' => null,
                'created_by' => $actor->id,
                'updated_by' => $actor->id,
            ])->save();

            $this->recordAuditLog->execute(
                action: 'user.created',
                actor: $actor,
                subject: $user,
                changes: ModelChanges::created($user, self::AUDITED_FIELDS),
                ip: $ip,
            );

            if ($pin !== null) {
                $this->recordAuditLog->execute(action: 'user.pin_set', actor: $actor, subject: $user, ip: $ip);
            }

            return $user->load('role');
        });
    }
}
