<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Actions\Purchasing\PurchaseItemResolver;
use App\Actions\Purchasing\ResolvedQuantity;
use App\Actions\Recipes\RecipeLineInput;
use App\Models\Ingredient;
use App\Models\Product;
use App\Models\RecipeLine;
use App\Rules\DecimalQuantity;
use App\Support\Quantity;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * PUT /api/v1/admin/products/{product}/recipe (permission `product.manage`; Ingredients, Recipes &
 * Purchasing → J): `{ lines: [{component_type, component_id, qty, unit}] (0..50) }`, the recipe per
 * 1 serving, replaced as a set.
 *
 * - `component_type`: `ingredient` or `product`. An ingredient must exist, not be deleted and be
 *   active; a product must exist, not be deleted and have `stock_mode = own` (`Only items with
 *   their own stock can be components.`: no nesting). 422 on `lines.{i}.component_id`.
 * - At most 50 lines: `Use at most 50 components.` on `lines`.
 * - No component twice: 422 on the repeat's `lines.{i}.component_id`.
 * - `qty` > 0 with at most 3 decimals, at most 1,000,000; `unit` valid for the component
 *   (UnitConversion; a product: `pc`, a whole number). `base_qty` must not round to 0.
 *
 * The messages follow the frontend's Q-031 proposal (provisional).
 */
class UpdateRecipeRequest extends FormRequest
{
    /**
     * A product component that isn't `own` (a `recipe` one: no nesting; a `none` one: no stock).
     */
    public const MESSAGE_NOT_OWN = 'Only items with their own stock can be components.';

    public const MESSAGE_MAX_LINES = 'Use at most 50 components.';

    public const MESSAGE_DUPLICATE = 'This component is already on the recipe.';

    /**
     * @var list<RecipeLineInput>
     */
    private array $resolvedLines = [];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->product()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'lines' => ['present', 'array', 'max:'.RecipeLine::MAX_LINES],
            'lines.*' => ['array'],
            'lines.*.component_type' => ['required', 'string', Rule::in([RecipeLine::COMPONENT_INGREDIENT, RecipeLine::COMPONENT_PRODUCT])],
            'lines.*.component_id' => ['required', 'integer'],
            'lines.*.qty' => ['required', new DecimalQuantity],
            'lines.*.unit' => ['required', 'string', 'max:20'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['lines.max' => self::MESSAGE_MAX_LINES];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->resolveLines($validator)];
    }

    private function resolveLines(Validator $validator): void
    {
        $lines = $this->input('lines');

        if (! is_array($lines) || $validator->errors()->has('lines')) {
            return;
        }

        $resolver = new PurchaseItemResolver;
        $resolved = [];
        $seen = [];

        foreach (array_values($lines) as $i => $line) {
            $fields = ['component_type', 'component_id', 'qty', 'unit'];

            if (! is_array($line) || collect($fields)->contains(fn (string $field) => $validator->errors()->has("lines.{$i}.{$field}"))) {
                continue;
            }

            $type = (string) $line['component_type'];
            $component = $resolver->find($type, (int) $line['component_id']);
            $error = $this->componentError($resolver, $component);

            if ($error !== null || $component === null) {
                $validator->errors()->add("lines.{$i}.component_id", (string) $error);

                continue;
            }

            $key = $type.':'.$component->id;

            if (isset($seen[$key])) {
                $validator->errors()->add("lines.{$i}.component_id", self::MESSAGE_DUPLICATE);

                continue;
            }

            $seen[$key] = true;
            $quantity = $resolver->quantity($component, (string) Quantity::parseInput($line['qty']), (string) $line['unit']);

            if (! $quantity instanceof ResolvedQuantity) {
                $validator->errors()->add("lines.{$i}.{$quantity[0]}", $quantity[1]);

                continue;
            }

            $resolved[] = new RecipeLineInput($component, $quantity);
        }

        $this->resolvedLines = $resolved;
    }

    private function componentError(PurchaseItemResolver $resolver, Ingredient|Product|null $component): ?string
    {
        if ($component instanceof Product && $component->stock_mode !== Product::STOCK_OWN) {
            return self::MESSAGE_NOT_OWN;
        }

        return $resolver->itemError($component);
    }

    /**
     * The validated lines, in the order sent.
     *
     * @return list<RecipeLineInput>
     */
    public function recipeLines(): array
    {
        return $this->resolvedLines;
    }

    public function product(): Product
    {
        /** @var Product */
        return $this->route('product');
    }
}
