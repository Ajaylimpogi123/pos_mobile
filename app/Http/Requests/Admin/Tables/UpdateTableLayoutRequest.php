<?php

namespace App\Http\Requests\Admin\Tables;

use App\Models\DiningTable;
use App\Models\User;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * PUT /api/v1/admin/tables/layout (Table Management → B; permission `settings.manage`): one
 * area's floor plan.
 *
 * - `area`: present, nullable, max 30 (trimmed; an empty string is null, the tables with no
 *   area); `tables`: 1–100 entries;
 * - `tables.*.id`: a non-deleted table of the caller's branch in that area, once each
 *   (`Table 5 isn't in this area.`);
 * - `tables.*.pos_x` / `pos_y`: both null or both integers ≥ 0 (`Place the table or leave it
 *   off the plan.` on `pos_x`); `width` / `height`: 1–6; `shape`: `rect` or `round`.
 *
 * The fit and overlap checks run on the area's final layout, under the tables' locks, in
 * App\Actions\Tabs\UpdateTableLayoutAction.
 */
class UpdateTableLayoutRequest extends FormRequest
{
    public const MESSAGE_NOT_IN_AREA = "Table %s isn't in this area.";

    public const MESSAGE_HALF_PLACED = 'Place the table or leave it off the plan.';

    /**
     * The branch's non-deleted tables, by id.
     *
     * @var Collection<int, DiningTable>|null
     */
    private ?Collection $branchTables = null;

    /**
     * @var Collection<int, int>|null
     */
    private ?Collection $areaTableIds = null;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('updateLayout', DiningTable::class) ?? false;
    }

    protected function prepareForValidation(): void
    {
        $area = $this->input('area');

        if (is_string($area)) {
            $area = trim($area);
            $this->merge(['area' => $area === '' ? null : $area]);
        }
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $size = ['required', 'integer', 'min:'.DiningTable::MIN_SIZE, 'max:'.DiningTable::MAX_SIZE];
        $position = ['present', 'nullable', 'integer', 'min:0'];

        return [
            'area' => ['present', 'nullable', 'string', 'max:'.DiningTableRules::MAX_AREA],
            'tables' => ['required', 'array', 'min:1', 'max:100'],
            'tables.*' => ['required', 'array'],
            'tables.*.id' => ['bail', 'required', 'integer', 'distinct', $this->inArea()],
            'tables.*.pos_x' => $position,
            'tables.*.pos_y' => $position,
            'tables.*.width' => $size,
            'tables.*.height' => $size,
            'tables.*.shape' => ['required', 'string', Rule::in(DiningTable::SHAPES)],
        ];
    }

    /**
     * `pos_x` and `pos_y` are both null or both set.
     *
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $tables = $this->input('tables');

            if (! is_array($tables)) {
                return;
            }

            foreach ($tables as $i => $entry) {
                if (! is_array($entry) || $validator->errors()->has("tables.{$i}.pos_x")) {
                    continue;
                }

                if (($entry['pos_x'] ?? null) === null xor ($entry['pos_y'] ?? null) === null) {
                    $validator->errors()->add("tables.{$i}.pos_x", self::MESSAGE_HALF_PLACED);
                }
            }
        }];
    }

    /**
     * The area as sent (null = the tables with no area).
     */
    public function area(): ?string
    {
        $area = $this->validated('area');

        return $area === null ? null : (string) $area;
    }

    /**
     * The validated entries.
     *
     * @return list<array{id: int, pos_x: int|null, pos_y: int|null, width: int, height: int, shape: string}>
     */
    public function entries(): array
    {
        return array_values(array_map(fn (array $entry) => [
            'id' => (int) $entry['id'],
            'pos_x' => $entry['pos_x'] === null ? null : (int) $entry['pos_x'],
            'pos_y' => $entry['pos_y'] === null ? null : (int) $entry['pos_y'],
            'width' => (int) $entry['width'],
            'height' => (int) $entry['height'],
            'shape' => (string) $entry['shape'],
        ], $this->validated('tables')));
    }

    /**
     * A non-deleted table of the caller's branch, in the body's area. Another branch's (or an
     * unknown) table is named by the id sent.
     */
    private function inArea(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $table = $this->branchTables()->get((int) $value);

            if ($table === null) {
                $fail(sprintf(self::MESSAGE_NOT_IN_AREA, $value));

                return;
            }

            if (! $this->areaTableIds()->contains($table->id)) {
                $fail(sprintf(self::MESSAGE_NOT_IN_AREA, $table->name));
            }
        };
    }

    /**
     * @return Collection<int, DiningTable>
     */
    private function branchTables(): Collection
    {
        /** @var User $user */
        $user = $this->user();

        return $this->branchTables ??= DiningTable::query()
            ->where('branch_id', $user->branch_id)
            ->get(['id', 'name'])
            ->keyBy('id');
    }

    /**
     * The ids of the branch's non-deleted tables in the body's area, matched by the database
     * (as UpdateTableLayoutAction does); none when `area` isn't a string or null.
     *
     * @return Collection<int, int>
     */
    private function areaTableIds(): Collection
    {
        /** @var User $user */
        $user = $this->user();
        $area = $this->input('area');

        if (! is_string($area) && $area !== null) {
            return $this->areaTableIds = collect();
        }

        return $this->areaTableIds ??= DiningTable::query()
            ->where('branch_id', $user->branch_id)
            ->inArea($area)
            ->pluck('id');
    }
}
