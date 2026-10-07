<?php

namespace App\Actions\Catalog;

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Inventory\IngredientUsage;
use App\Exceptions\ConflictException;
use App\Models\Ingredient;
use App\Models\IngredientUnit;
use App\Models\User;
use App\Support\ModelChanges;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Creates an ingredient (`ingredient.created`) or applies a partial update
 * (`ingredient.updated`, only what changed) with its own units (Ingredients, Recipes &
 * Purchasing → A, D). Under the ingredient's row lock:
 *
 * - `base_unit` can't change once the ingredient is in use (IngredientUsage::isInUse): 409
 *   `The base unit can't change once the ingredient is in use.`
 * - `units`, when sent, replaces the set by `id`: a unit with an `id` is updated, one without is
 *   added, and a missing one is removed. A unit on an open PO line can't be removed, renamed or
 *   have its factor changed: 409 `The unit "<name>" is on an open purchase order.` (provisional
 *   wording, Q-030).
 * - The audit entry carries the changed fields and, when the set changed, `units: { from, to }`
 *   (each `{name, factor}`).
 */
class SaveIngredientAction
{
    public const AUDITED_FIELDS = ['name', 'base_unit', 'is_active'];

    public const MESSAGE_BASE_UNIT_LOCKED = "The base unit can't change once the ingredient is in use.";

    public const MESSAGE_UNIT_IN_USE = 'The unit "%s" is on an open purchase order.';

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly IngredientUsage $usage,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated `name`, `base_unit`, `is_active`
     * @param  list<array{id: int|null, name: string, factor: string}>|null  $units
     */
    public function create(array $attributes, ?array $units, User $actor, ?string $ip = null): Ingredient
    {
        return DB::transaction(function () use ($attributes, $units, $actor, $ip): Ingredient {
            $ingredient = new Ingredient;
            $ingredient->fill($attributes);
            $ingredient->forceFill(['created_by' => $actor->id, 'updated_by' => $actor->id])->save();

            foreach ($units ?? [] as $unit) {
                $ingredient->units()->create(['name' => $unit['name'], 'factor' => $unit['factor']]);
            }

            $this->recordAuditLog->execute(
                action: 'ingredient.created',
                actor: $actor,
                subject: $ingredient,
                changes: [
                    ...ModelChanges::created($ingredient, self::AUDITED_FIELDS),
                    'units' => ['from' => null, 'to' => $this->snapshot($ingredient->units()->get()->all())],
                ],
                ip: $ip,
            );

            return $ingredient;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes  Validated fields (only those sent)
     * @param  list<array{id: int|null, name: string, factor: string}>|null  $units  null when not sent
     *
     * @throws ConflictException 409 on the base unit or a unit on an open PO line
     */
    public function update(Ingredient $ingredient, array $attributes, ?array $units, User $actor, ?string $ip = null): Ingredient
    {
        return DB::transaction(function () use ($ingredient, $attributes, $units, $actor, $ip): Ingredient {
            Ingredient::query()->whereKey($ingredient->id)->lockForUpdate()->first();

            $ingredient->fill($attributes);
            $changes = ModelChanges::diff($ingredient);

            if (array_key_exists('base_unit', $changes) && $this->usage->isInUse($ingredient->id)) {
                throw new ConflictException(self::MESSAGE_BASE_UNIT_LOCKED);
            }

            $before = $ingredient->units()->get();

            if ($units !== null && $this->replaceUnits($ingredient, $before->all(), $units)) {
                $changes['units'] = [
                    'from' => $this->snapshot($before->all()),
                    'to' => $this->snapshot($ingredient->units()->get()->all()),
                ];
            }

            $ingredient->unsetRelation('units');

            if ($changes === []) {
                return $ingredient;
            }

            $ingredient->forceFill(['updated_by' => $actor->id])->save();

            $this->recordAuditLog->execute(
                action: 'ingredient.updated',
                actor: $actor,
                subject: $ingredient,
                changes: $changes,
                ip: $ip,
            );

            return $ingredient;
        });
    }

    /**
     * Replace the units by id. Returns whether anything changed.
     *
     * @param  list<IngredientUnit>  $existing
     * @param  list<array{id: int|null, name: string, factor: string}>  $units
     *
     * @throws ConflictException
     */
    private function replaceUnits(Ingredient $ingredient, array $existing, array $units): bool
    {
        $sent = collect($units)->filter(fn (array $unit) => $unit['id'] !== null)->keyBy('id');
        $openUnits = $this->usage->openLineUnits($ingredient->id);

        $removed = [];
        $changed = [];

        foreach ($existing as $unit) {
            $next = $sent->get($unit->id);
            $onOpenLine = in_array(Str::lower($unit->name), $openUnits, true);

            if ($next === null) {
                if ($onOpenLine) {
                    throw new ConflictException(sprintf(self::MESSAGE_UNIT_IN_USE, $unit->name));
                }

                $removed[] = $unit;

                continue;
            }

            $renamed = Str::lower($next['name']) !== Str::lower($unit->name);
            $refactored = ! BigDecimal::of($next['factor'])->isEqualTo((string) $unit->factor);

            if ($onOpenLine && ($renamed || $refactored)) {
                throw new ConflictException(sprintf(self::MESSAGE_UNIT_IN_USE, $unit->name));
            }

            if ($refactored || $next['name'] !== $unit->name) {
                $changed[] = [$unit, $next];
            }
        }

        $added = array_values(array_filter($units, fn (array $unit) => $unit['id'] === null));

        if ($removed === [] && $changed === [] && $added === []) {
            return false;
        }

        foreach ($removed as $unit) {
            $unit->delete();
        }

        // Two steps, so names swapped between units never clash with the unique index.
        foreach ($changed as [$unit]) {
            $unit->forceFill(['name' => '~'.$unit->id])->save();
        }

        foreach ($changed as [$unit, $next]) {
            $unit->forceFill(['name' => $next['name'], 'factor' => $next['factor']])->save();
        }

        foreach ($added as $unit) {
            $ingredient->units()->create(['name' => $unit['name'], 'factor' => $unit['factor']]);
        }

        return true;
    }

    /**
     * @param  list<IngredientUnit>  $units
     * @return list<array{name: string, factor: string}>
     */
    private function snapshot(array $units): array
    {
        return array_map(fn (IngredientUnit $unit) => [
            'name' => $unit->name,
            'factor' => Quantity::normalize((string) $unit->factor),
        ], $units);
    }
}
