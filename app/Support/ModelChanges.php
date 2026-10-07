<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model;

/**
 * Builds the audit log `changes` payload: `{ field: { from, to } }`, using the
 * model's cast values (e.g. booleans stay booleans, money stays integer cents).
 */
final class ModelChanges
{
    /**
     * Bookkeeping columns that are never reported as business changes.
     */
    private const IGNORED = ['created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at'];

    /**
     * Secrets that must never reach the audit trail, not even as hashes.
     */
    private const SECRET = ['password', 'pin', 'pin_hash', 'remember_token'];

    /**
     * The fields changed on the model since it was loaded (call before save()).
     * Returns an empty array when nothing changed.
     *
     * @return array<string, array{from: mixed, to: mixed}>
     */
    public static function diff(Model $model): array
    {
        $changes = [];

        foreach (array_keys($model->getDirty()) as $field) {
            if (in_array($field, self::IGNORED, true) || in_array($field, self::SECRET, true)) {
                continue;
            }

            $changes[$field] = [
                'from' => $model->getOriginal($field),
                'to' => $model->getAttribute($field),
            ];
        }

        return $changes;
    }

    /**
     * The initial values of a newly created model, as changes from `null`.
     *
     * @param  list<string>  $fields
     * @return array<string, array{from: null, to: mixed}>
     */
    public static function created(Model $model, array $fields): array
    {
        $changes = [];

        foreach (array_diff($fields, self::SECRET) as $field) {
            $changes[$field] = ['from' => null, 'to' => $model->getAttribute($field)];
        }

        return $changes;
    }
}
