<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Http\Requests\Admin\Tables\UpdateTableLayoutRequest;
use App\Models\Branch;
use App\Models\DiningTable;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Saves one area's floor plan (PUT /api/v1/admin/tables/layout, Table Management → B).
 *
 * In one transaction the area's non-deleted tables are locked, the body's entries are laid
 * over them, and the **final** layout is checked (tables not in the body count where they
 * already are), each failure as a `422` on `tables.{i}.pos_x`:
 *
 * - inside the 24 × 16 grid: `pos_x + width ≤ 24` and `pos_y + height ≤ 16`
 *   (`Table 5 doesn't fit on the plan.`);
 * - no overlap with another placed table of the area, by their rectangles (a round table
 *   counts as its square): `Table 5 overlaps Table 6.`
 *
 * All of it is saved or none of it. Audit: one `table.layout_updated` (`{area, count}`).
 * Returns the area's tables in the admin order.
 */
class UpdateTableLayoutAction
{
    public const MESSAGE_DOESNT_FIT = "Table %s doesn't fit on the plan.";

    public const MESSAGE_OVERLAPS = 'Table %s overlaps Table %s.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  list<array{id: int, pos_x: int|null, pos_y: int|null, width: int, height: int, shape: string}>  $entries
     * @return Collection<int, DiningTable>
     *
     * @throws ValidationException
     */
    public function execute(User $actor, ?string $area, array $entries, ?string $ip = null): Collection
    {
        return DB::transaction(function () use ($actor, $area, $entries, $ip): Collection {
            $tables = DiningTable::query()
                ->where('branch_id', $actor->branch_id)
                ->inArea($area)
                ->orderBy('sort_order')
                ->orderBy('name')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            $byId = $tables->keyBy('id');

            $this->ensureInArea((int) $actor->branch_id, $byId, $entries);

            foreach ($entries as $entry) {
                $byId[$entry['id']]->forceFill([
                    'pos_x' => $entry['pos_x'],
                    'pos_y' => $entry['pos_y'],
                    'width' => $entry['width'],
                    'height' => $entry['height'],
                    'shape' => $entry['shape'],
                ]);
            }

            $this->ensureLayoutFits($tables, $byId, $entries);

            foreach ($tables as $table) {
                if ($table->isDirty()) {
                    $table->forceFill(['updated_by' => $actor->id])->save();
                }
            }

            $this->recordAuditLog->execute(
                action: 'table.layout_updated',
                actor: $actor,
                subject: Branch::query()->find($actor->branch_id),
                changes: ['area' => $area, 'count' => count($entries)],
                ip: $ip,
            );

            return $tables;
        });
    }

    /**
     * Re-checks, under the locks, that every entry is a table of the area.
     *
     * @param  Collection<int, DiningTable>  $byId
     * @param  list<array{id: int}>  $entries
     *
     * @throws ValidationException
     */
    private function ensureInArea(int $branchId, Collection $byId, array $entries): void
    {
        $errors = [];

        foreach ($entries as $i => $entry) {
            if (! $byId->has($entry['id'])) {
                $name = DiningTable::query()->where('branch_id', $branchId)->whereKey($entry['id'])->value('name');
                $errors["tables.{$i}.id"] = sprintf(UpdateTableLayoutRequest::MESSAGE_NOT_IN_AREA, $name ?? $entry['id']);
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * The fit and overlap checks of the body's placed tables against the final layout.
     *
     * @param  Collection<int, DiningTable>  $tables  The area's tables, in the admin order
     * @param  Collection<int, DiningTable>  $byId
     * @param  list<array{id: int}>  $entries
     *
     * @throws ValidationException
     */
    private function ensureLayoutFits(Collection $tables, Collection $byId, array $entries): void
    {
        $errors = [];

        foreach ($entries as $i => $entry) {
            $table = $byId[$entry['id']];

            if (! $table->isPlaced()) {
                continue;
            }

            if ($table->pos_x + $table->width > DiningTable::GRID_WIDTH || $table->pos_y + $table->height > DiningTable::GRID_HEIGHT) {
                $errors["tables.{$i}.pos_x"] = sprintf(self::MESSAGE_DOESNT_FIT, $table->name);

                continue;
            }

            $other = $tables->first(fn (DiningTable $other) => $other->id !== $table->id
                && $other->isPlaced()
                && self::overlap($table, $other));

            if ($other !== null) {
                $errors["tables.{$i}.pos_x"] = sprintf(self::MESSAGE_OVERLAPS, $table->name, $other->name);
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * Whether two placed tables' rectangles overlap (touching edges don't).
     */
    private static function overlap(DiningTable $a, DiningTable $b): bool
    {
        return $a->pos_x < $b->pos_x + $b->width
            && $b->pos_x < $a->pos_x + $a->width
            && $a->pos_y < $b->pos_y + $b->height
            && $b->pos_y < $a->pos_y + $a->height;
    }
}
