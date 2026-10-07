<?php

namespace App\Actions\Dashboard;

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Ingredient;
use App\Models\Printer;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Builds the short human `summary` of audit entries, e.g. `Updated product "Egg with Rice"`.
 *
 * The subject's name is looked up live (soft-deleted subjects included), with one query
 * per subject type present, never per row. When the subject row is gone the name falls
 * back to the snapshot in `changes` (`name`, `full_name`, `first_name`/`last_name`, as a
 * plain value or the `to` of a `{from, to}` pair), and then to a generic noun
 * (`Updated a product`).
 *
 * Printers (Phase 4) read `Added printer "Kitchen"` / `Updated printer "Kitchen"` /
 * `Removed printer "Kitchen"`; `settings.updated` reads `Updated the receipt settings`.
 *
 * Stock entries (Inventory, v1 completion) read `Received 24 "Iced Tea"`, `Wasted 1 "Iced Tea"`,
 * `Counted "Iced Tea" (35 → 33)`, `Adjusted stock of "Iced Tea" (+24)` and
 * `Set reorder level of "Iced Tea" to 10`.
 *
 * Only a subject's **name** is ever put into a summary, plus the quantities of a
 * `stock.adjusted` entry and the new reorder level. Other `changes` values (and therefore any
 * password, PIN or hash) never are.
 */
class DescribeAuditEntries
{
    /**
     * Subject types whose names may be looked up, with the noun used in summaries.
     *
     * `verbs` overrides VERBS for that subject type.
     *
     * @var array<class-string<Model>, array{noun: string, article: string, verbs?: array<string, string>}>
     */
    private const SUBJECTS = [
        Product::class => ['noun' => 'product', 'article' => 'a'],
        Category::class => ['noun' => 'category', 'article' => 'a'],
        Customer::class => ['noun' => 'customer', 'article' => 'a'],
        User::class => ['noun' => 'staff account', 'article' => 'a'],
        Printer::class => ['noun' => 'printer', 'article' => 'a', 'verbs' => [
            'created' => 'Added %s',
            'deleted' => 'Removed %s',
        ]],
        Ingredient::class => ['noun' => 'ingredient', 'article' => 'an'],
        Supplier::class => ['noun' => 'supplier', 'article' => 'a'],
    ];

    /**
     * The summary of a `settings.updated` entry (Phase 4; its subject is the branch).
     */
    public const SETTINGS_UPDATED = 'Updated the receipt settings';

    /**
     * Summary templates by the action's verb (the part after the first dot).
     * `%s` is the subject: `product "Egg with Rice"` (or `a product`); `%n` is the
     * bare quoted name (or the generic noun).
     */
    private const VERBS = [
        'created' => 'Created %s',
        'updated' => 'Updated %s',
        'deleted' => 'Deleted %s',
        'image_updated' => 'Updated the photo of %s',
        'image_removed' => 'Removed the photo of %s',
        'password_reset' => 'Reset the password of %n',
        'pin_set' => 'Set the PIN of %n',
        'pin_removed' => 'Removed the PIN of %n',
    ];

    /**
     * @param  Collection<int, AuditLog>  $entries
     * @return array<int, string> summaries keyed by audit entry id
     */
    public function execute(Collection $entries): array
    {
        $names = $this->lookUpNames($entries);

        return $entries
            ->mapWithKeys(fn (AuditLog $entry) => [$entry->id => $this->summarise($entry, $names)])
            ->all();
    }

    /**
     * @param  array<string, array<int, string>>  $names  class => [id => name]
     */
    private function summarise(AuditLog $entry, array $names): string
    {
        $class = $this->subjectClass($entry->subject_type);
        $meta = $class !== null ? self::SUBJECTS[$class] : null;

        $name = $class !== null && $entry->subject_id !== null
            ? ($names[$class][(int) $entry->subject_id] ?? null)
            : null;
        $name ??= $this->snapshotName($entry->changes);

        if ($entry->action === 'settings.updated') {
            return self::SETTINGS_UPDATED;
        }

        if ($entry->action === 'stock.adjusted') {
            return $this->describeStockAdjustment($name, $entry->changes, $meta);
        }

        if ($entry->action === 'stock.reorder_level_changed') {
            return $this->describeReorderLevel($name, $entry->changes, $meta);
        }

        $verb = Str::after($entry->action, '.');
        $template = $meta['verbs'][$verb] ?? self::VERBS[$verb] ?? null;

        if ($template === null || $meta === null) {
            // An action this phase does not know yet: "Order voided" / "Order voided "Egg with Rice"".
            $phrase = Str::ucfirst(str_replace(['.', '_'], ' ', $entry->action));

            return $name !== null ? "{$phrase} \"{$name}\"" : $phrase;
        }

        $quoted = $name !== null ? "\"{$name}\"" : null;

        return strtr($template, [
            '%s' => $quoted !== null ? "{$meta['noun']} {$quoted}" : "{$meta['article']} {$meta['noun']}",
            '%n' => $quoted ?? "{$meta['article']} {$meta['noun']}",
        ]);
    }

    /**
     * `Adjusted stock of "Iced Tea" (+24)` (Phase 3): the product's name and the signed
     * change from the entry's `{ qty: { from, to } }`. Without a name: `a product`.
     *
     * @param  array<string, mixed>|null  $changes
     */
    private function describeStockAdjustment(?string $name, ?array $changes, ?array $meta = null): string
    {
        $product = $name !== null ? "\"{$name}\"" : ($meta !== null ? "{$meta['article']} {$meta['noun']}" : 'a product');

        $from = $changes['qty']['from'] ?? null;
        $to = $changes['qty']['to'] ?? null;

        if (is_string($from) && is_string($to) && is_numeric($from) && is_numeric($to)) {
            return $this->describeIngredientAdjustment($product, $from, $to, $changes);
        }

        $known = is_int($from) && is_int($to);

        // Inventory (v1 completion): stock in, wastage and counts have their own wording.
        switch ($changes['type'] ?? null) {
            case 'receipt':
                return $known ? sprintf('Received %d %s', $to - $from, $product) : "Received stock of {$product}";
            case 'wastage':
                return $known ? sprintf('Wasted %d %s', $from - $to, $product) : "Wasted stock of {$product}";
            case 'count':
                return "Counted {$product}".($known ? " ({$from} → {$to})" : '');
        }

        $summary = "Adjusted stock of {$product}";

        if ($known) {
            $summary .= sprintf(' (%+d)', $to - $from);
        }

        return $summary;
    }

    /**
     * An ingredient's adjustment (Ingredients, Recipes & Purchasing), whose quantities are base-unit
     * strings: `Wasted 0.25 kg "Flour"`, `Counted "Flour" (5000.000 → 4800.000)`,
     * `Adjusted stock of "Flour" (+250.000)`.
     *
     * @param  array<string, mixed>|null  $changes
     */
    private function describeIngredientAdjustment(string $subject, string $from, string $to, ?array $changes): string
    {
        $delta = BigDecimal::of($to)->minus($from);
        $entered = $changes['entered_qty'] ?? null;
        $unit = $changes['entered_unit'] ?? null;

        return match ($changes['type'] ?? null) {
            'wastage' => is_string($entered) && is_numeric($entered) && is_string($unit)
                ? sprintf('Wasted %s %s %s', Quantity::normalize(BigDecimal::of($entered)->abs()), $unit, $subject)
                : "Wasted stock of {$subject}",
            'count' => "Counted {$subject} ({$from} → {$to})",
            default => sprintf('Adjusted stock of %s (%s%s)', $subject, $delta->isNegative() ? '' : '+', Quantity::format($delta)),
        };
    }

    /**
     * `Set reorder level of "Iced Tea" to 10` (Inventory, v1 completion), or when it was
     * cleared `Removed reorder level of "Iced Tea"` (provisional, Q-022).
     *
     * @param  array<string, mixed>|null  $changes
     */
    private function describeReorderLevel(?string $name, ?array $changes, ?array $meta = null): string
    {
        $product = $name !== null ? "\"{$name}\"" : ($meta !== null ? "{$meta['article']} {$meta['noun']}" : 'a product');
        $to = $changes['reorder_level']['to'] ?? null;

        // An ingredient's level is a base-unit string (Ingredients, Recipes & Purchasing).
        return is_int($to) || (is_string($to) && is_numeric($to))
            ? "Set reorder level of {$product} to {$to}"
            : "Removed reorder level of {$product}";
    }

    /**
     * Current names of the entries' subjects, soft-deleted ones included: one query per type.
     *
     * @param  Collection<int, AuditLog>  $entries
     * @return array<string, array<int, string>>
     */
    private function lookUpNames(Collection $entries): array
    {
        $names = [];

        $entries
            ->filter(fn (AuditLog $entry) => $entry->subject_id !== null && $this->subjectClass($entry->subject_type) !== null)
            ->groupBy(fn (AuditLog $entry) => $this->subjectClass($entry->subject_type))
            ->each(function (Collection $group, string $class) use (&$names) {
                $ids = $group->pluck('subject_id')->map(fn ($id) => (int) $id)->unique()->values()->all();

                $names[$class] = match ($class) {
                    Customer::class => Customer::withTrashed()->whereKey($ids)->get(['id', 'first_name', 'last_name'])
                        ->mapWithKeys(fn (Customer $customer) => [$customer->id => $customer->full_name])->all(),
                    default => $class::withTrashed()->whereKey($ids)->pluck('name', 'id')->all(),
                };
            });

        return $names;
    }

    /**
     * The model class of a morph type, if it is one of the known subject types.
     *
     * @return class-string<Model>|null
     */
    private function subjectClass(?string $type): ?string
    {
        if ($type === null) {
            return null;
        }

        $class = Relation::getMorphedModel($type) ?? $type;

        return array_key_exists($class, self::SUBJECTS) ? $class : null;
    }

    /**
     * The subject's name as recorded in the entry's `changes`, if any.
     *
     * @param  array<string, mixed>|null  $changes
     */
    private function snapshotName(?array $changes): ?string
    {
        if ($changes === null) {
            return null;
        }

        $value = fn (string $key): ?string => $this->scalar($changes[$key] ?? null);

        $name = $value('name') ?? $value('full_name');

        if ($name === null && ($first = $value('first_name')) !== null) {
            $name = trim($first.' '.($value('last_name') ?? ''));
        }

        return $name === '' ? null : $name;
    }

    /**
     * A snapshot value: a plain string, or the `to` side of a `{from, to}` change.
     */
    private function scalar(mixed $value): ?string
    {
        if (is_array($value)) {
            $value = $value['to'] ?? null;
        }

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
