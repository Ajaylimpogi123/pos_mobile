<?php

namespace App\Http\Requests\Purchasing;

use App\Actions\Purchasing\PurchaseItemResolver;
use App\Actions\Purchasing\ResolvedQuantity;
use App\Http\Requests\Admin\Catalog\StoreProductRequest;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Rules\DecimalQuantity;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * PATCH /api/v1/purchase-orders/{purchaseOrder} (`purchase.request` or `purchase.approve`):
 * partial `expected_delivery_date`, `remarks` (max 500) and `lines` edited **by id**:
 * `[{ id, qty?, unit?, unit_price_cents?, supplier_id? }]` (1 to 100). Every `id` is one of this
 * PO's lines (lines can't be added). A new `qty` / `unit` is checked against the line's item (a
 * `qty` alone keeps the line's unit). Only while the PO is pending approval (a 409 from the
 * action).
 */
class UpdatePurchaseOrderRequest extends FormRequest
{
    use PurchaseOrderLineInput;

    /**
     * Resolved line changes, by line id.
     *
     * @var array<int, array{quantity?: ResolvedQuantity, unit_price_cents?: int, supplier_id?: int}>
     */
    private array $lineChanges = [];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->purchaseOrder()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'expected_delivery_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'remarks' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines' => ['sometimes', 'array', 'min:1', 'max:100'],
            'lines.*' => ['array'],
            'lines.*.id' => [
                'required', 'integer', 'distinct',
                Rule::exists('purchase_order_lines', 'id')->where('purchase_order_id', $this->purchaseOrder()->id),
            ],
            'lines.*.qty' => ['sometimes', 'required', new DecimalQuantity],
            'lines.*.unit' => ['sometimes', 'required', 'string', 'max:20'],
            'lines.*.unit_price_cents' => ['sometimes', 'required', 'integer:strict', 'min:0', 'max:'.StoreProductRequest::MAX_CENTS],
            'lines.*.supplier_id' => ['sometimes', 'required', 'integer', Rule::exists('suppliers', 'id')->whereNull('deleted_at')->where('is_active', true)],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $lines = $this->input('lines');

            if (! is_array($lines) || $validator->errors()->isNotEmpty()) {
                return;
            }

            $existing = $this->purchaseOrder()->lines()->with(['ingredient', 'product'])->get()->keyBy('id');
            $resolver = new PurchaseItemResolver;

            foreach (array_values($lines) as $i => $input) {
                /** @var PurchaseOrderLine $line */
                $line = $existing->get((int) $input['id']);
                $changes = [];

                if (array_key_exists('qty', $input) || array_key_exists('unit', $input)) {
                    $quantity = $this->lineQuantity($resolver, $line, (string) ($input['qty'] ?? $line->qty), (string) ($input['unit'] ?? $line->unit));

                    if (! $quantity instanceof ResolvedQuantity) {
                        $validator->errors()->add("lines.{$i}.{$quantity[0]}", $quantity[1]);

                        continue;
                    }

                    $changes['quantity'] = $quantity;
                }

                if (array_key_exists('unit_price_cents', $input)) {
                    $changes['unit_price_cents'] = (int) $input['unit_price_cents'];
                }

                if (array_key_exists('supplier_id', $input)) {
                    $changes['supplier_id'] = (int) $input['supplier_id'];
                }

                $this->lineChanges[$line->id] = $changes;
            }
        }];
    }

    public function purchaseOrder(): PurchaseOrder
    {
        /** @var PurchaseOrder */
        return $this->route('purchaseOrder');
    }

    /**
     * The sent `expected_delivery_date` / `remarks`.
     *
     * @return array<string, string|null>
     */
    public function fields(): array
    {
        $fields = array_intersect_key($this->validated(), array_flip(['expected_delivery_date', 'remarks']));

        return array_map(fn ($value) => $value === '' ? null : $value, $fields);
    }

    /**
     * @return array<int, array{quantity?: ResolvedQuantity, unit_price_cents?: int, supplier_id?: int}>
     */
    public function lineChanges(): array
    {
        return $this->lineChanges;
    }
}
