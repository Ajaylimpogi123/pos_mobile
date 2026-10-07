<?php

namespace App\Actions\Staff;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

/**
 * Applies a partial update (`name`, `email`, `role_id`, `is_active`) to a staff account.
 *
 * - Self-protection (409): you cannot change your own role or deactivate yourself.
 *   Sending your current `role_id` unchanged is not a role change.
 * - Deactivating a user revokes all of that user's tokens at once.
 * - Only the fields actually changed are written to the `user.updated` audit entry.
 *   A request that changes nothing writes nothing and leaves `updated_at` alone.
 */
class UpdateStaffUserAction
{
    public const MESSAGE_OWN_ROLE = 'You cannot change your own role.';

    public const MESSAGE_DEACTIVATE_SELF = 'You cannot deactivate your own account.';

    public const EDITABLE_FIELDS = ['name', 'email', 'role_id', 'is_active'];

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     *
     * @throws ConflictException 409 on a self-protection violation
     */
    public function execute(User $target, array $attributes, User $actor, ?string $ip = null): User
    {
        $attributes = Arr::only($attributes, self::EDITABLE_FIELDS);

        if ($target->is($actor)) {
            if (array_key_exists('role_id', $attributes) && (int) $attributes['role_id'] !== (int) $target->role_id) {
                throw new ConflictException(self::MESSAGE_OWN_ROLE);
            }

            if (array_key_exists('is_active', $attributes) && ! filter_var($attributes['is_active'], FILTER_VALIDATE_BOOLEAN)) {
                throw new ConflictException(self::MESSAGE_DEACTIVATE_SELF);
            }
        }

        return DB::transaction(function () use ($target, $attributes, $actor, $ip): User {
            $target->fill($attributes);

            $changes = ModelChanges::diff($target);

            if ($changes === []) {
                return $target;
            }

            $target->forceFill(['updated_by' => $actor->id])->save();

            if (array_key_exists('is_active', $changes) && $target->is_active === false) {
                $target->revokeApiTokens();
            }

            $this->recordAuditLog->execute(
                action: 'user.updated',
                actor: $actor,
                subject: $target,
                changes: $changes,
                ip: $ip,
            );

            if (array_key_exists('role_id', $changes)) {
                $target->load('role');
            }

            return $target;
        });
    }
}
