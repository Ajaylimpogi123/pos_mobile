<?php

namespace App\Http\Requests\Admin\Tables;

use App\Models\DiningTable;
use Closure;
use Illuminate\Http\Request;

/**
 * The field rules of a dine-in table (Dine-in Tables & Tabs → B), shared by the admin
 * store and update requests:
 *
 * - `name`: required, max 10, `^[A-Za-z0-9 -]+$` (the `table_no` rule), trimmed, unique among
 *   the branch's non-deleted tables (`There is already a table named 5.`);
 * - `area`: nullable, max 30 (trimmed; an empty string becomes null);
 * - `seats`: required on create, 1–50; `sort_order`: 0–9999; `is_active`: boolean.
 */
final class DiningTableRules
{
    public const MAX_NAME = 10;

    public const MAX_AREA = 30;

    public const MESSAGE_NAME_TAKEN = 'There is already a table named %s.';

    /**
     * @return array<string, list<mixed>>
     */
    public static function rules(bool $store, int $branchId, ?DiningTable $ignore = null): array
    {
        $required = $store ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'bail', 'string', 'max:'.self::MAX_NAME, 'regex:/^[A-Za-z0-9 -]+$/D', self::uniqueName($branchId, $ignore)],
            'area' => ['sometimes', 'nullable', 'string', 'max:'.self::MAX_AREA],
            'seats' => [$required, 'integer', 'min:1', 'max:50'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * Trims `name` and `area`; an empty `area` becomes null.
     */
    public static function prepare(Request $request): void
    {
        $merge = [];

        foreach (['name', 'area'] as $key) {
            $value = $request->input($key);

            if (is_string($value)) {
                $value = trim($value);
                $merge[$key] = $key === 'area' && $value === '' ? null : $value;
            }
        }

        $request->merge($merge);
    }

    private static function uniqueName(int $branchId, ?DiningTable $ignore): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($branchId, $ignore): void {
            $taken = DiningTable::query()
                ->where('branch_id', $branchId)
                ->where('name', $value)
                ->when($ignore !== null, fn ($query) => $query->whereKeyNot($ignore->id))
                ->exists();

            if ($taken) {
                $fail(sprintf(self::MESSAGE_NAME_TAKEN, $value));
            }
        };
    }
}
