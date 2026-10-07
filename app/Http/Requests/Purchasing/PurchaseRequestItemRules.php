<?php

namespace App\Http\Requests\Purchasing;

use App\Actions\Purchasing\PurchaseItemResolver;
use App\Actions\Purchasing\PurchaseRequestItemInput;
use App\Actions\Purchasing\ResolvedQuantity;
use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use App\Rules\DecimalQuantity;
use App\Support\Quantity;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * The `items` of a purchase request body (Ingredients, Recipes & Purchasing → F), 1 to 100:
 * `{ id?, item_type, item_id, supplier_id, qty, unit, estimated_unit_price_cents?, remarks? }`.
 *
 * - `item_type`: `ingredient` or `product`; the item must exist, an ingredient must be active and
 *   a product must track stock (PurchaseItemResolver);
 * - `supplier_id`: an active, non-deleted supplier (an inactive one is `The selected
 *   items.{i}.supplier_id is invalid.`);
 * - `qty` > 0 with at most 3 decimals, at most 1,000,000 (a product's is whole); `unit` valid for
 *   the item;
 * - `estimated_unit_price_cents`: integer centavos per entered unit, 0 to 100,000,000, nullable;
 * - `id` (edits only): one of this PR's items, each at most once.
 *
 * Every item object is complete, also on an edit (provisional, Q-030).
 */
trait PurchaseRequestItemRules
{
    public const MAX_ITEMS = 100;

    public const MAX_PRICE_CENTS = 100000000;

    /**
     * @var list<PurchaseRequestItemInput>
     */
    private array $resolvedItems = [];

    /**
     * @return array<string, list<mixed>>
     */
    protected function itemRules(bool $required, ?PurchaseRequest $purchaseRequest = null): array
    {
        return [
            'items' => [$required ? 'required' : 'sometimes', 'array', 'min:1', 'max:'.self::MAX_ITEMS],
            'items.*' => ['array'],
            'items.*.id' => $purchaseRequest === null
                ? ['prohibited']
                : ['sometimes', 'nullable', 'integer', 'distinct', Rule::exists('purchase_request_items', 'id')->where('purchase_request_id', $purchaseRequest->id)],
            'items.*.item_type' => ['required', 'string', Rule::in([PurchaseRequestItem::ITEM_INGREDIENT, PurchaseRequestItem::ITEM_PRODUCT])],
            'items.*.item_id' => ['required', 'integer'],
            'items.*.supplier_id' => ['required', 'integer', Rule::exists('suppliers', 'id')->whereNull('deleted_at')->where('is_active', true)],
            'items.*.qty' => ['required', new DecimalQuantity],
            'items.*.unit' => ['required', 'string', 'max:20'],
            'items.*.estimated_unit_price_cents' => ['sometimes', 'nullable', 'integer:strict', 'min:0', 'max:'.self::MAX_PRICE_CENTS],
            'items.*.remarks' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    /**
     * Resolve each item (the item, its unit and quantity) once the field rules pass.
     */
    protected function resolveItems(Validator $validator): void
    {
        $items = $this->input('items');

        if (! is_array($items) || $validator->errors()->has('items')) {
            return;
        }

        $resolver = new PurchaseItemResolver;
        $resolved = [];

        foreach (array_values($items) as $i => $item) {
            $fields = ['item_type', 'item_id', 'supplier_id', 'qty', 'unit', 'estimated_unit_price_cents', 'id'];

            if (! is_array($item) || collect($fields)->contains(fn (string $field) => $validator->errors()->has("items.{$i}.{$field}"))) {
                continue;
            }

            $model = $resolver->find((string) $item['item_type'], (int) $item['item_id']);
            $error = $resolver->itemError($model);

            if ($error !== null || $model === null) {
                $validator->errors()->add("items.{$i}.item_id", (string) $error);

                continue;
            }

            $quantity = $resolver->quantity($model, (string) Quantity::parseInput($item['qty']), (string) $item['unit']);

            if (! $quantity instanceof ResolvedQuantity) {
                $validator->errors()->add("items.{$i}.{$quantity[0]}", $quantity[1]);

                continue;
            }

            $resolved[] = new PurchaseRequestItemInput(
                id: isset($item['id']) ? (int) $item['id'] : null,
                item: $model,
                supplierId: (int) $item['supplier_id'],
                quantity: $quantity,
                estimatedUnitPriceCents: isset($item['estimated_unit_price_cents']) ? (int) $item['estimated_unit_price_cents'] : null,
                remarks: isset($item['remarks']) && $item['remarks'] !== '' ? (string) $item['remarks'] : null,
            );
        }

        $this->resolvedItems = $resolved;
    }

    /**
     * The validated items.
     *
     * @return list<PurchaseRequestItemInput>
     */
    public function items(): array
    {
        return $this->resolvedItems;
    }
}
