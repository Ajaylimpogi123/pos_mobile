<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\Product;
use App\Models\StockMovement;
use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/products/{product}/stock-adjustments (permission
 * `inventory.adjust`; idempotent).
 *
 * An optional `type` (Inventory, v1 completion; default `adjustment`) decides the rules:
 *
 * | type | quantity | reason |
 * |---|---|---|
 * | adjustment | exactly one of `qty_delta` (non-zero, −100000 to 100000) or `counted_qty` (0 to 100000) | required |
 * | receipt | `qty_delta` ≥ 1 (`Stock in must add stock.`), optional `unit_cost_cents` (0 to 100000000) | optional |
 * | count | `counted_qty` (0 to 100000) | required |
 * | wastage | `qty_delta` ≤ −1 (`Wastage must remove stock.`) | required |
 *
 * `unit_cost_cents` on any other type than `receipt` is refused (`Only stock in has a unit
 * cost.`). The quantity field a type doesn't use is prohibited. A `null` value counts as not
 * sent. The server works out a count's delta under the row lock (AdjustStockAction).
 */
class StoreStockAdjustmentRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    public const MAX_QTY = 100000;

    public const MAX_UNIT_COST_CENTS = 100000000;

    /**
     * The `type` values this endpoint accepts.
     */
    public const TYPES = [
        StockMovement::TYPE_ADJUSTMENT, StockMovement::TYPE_RECEIPT, StockMovement::TYPE_COUNT, StockMovement::TYPE_WASTAGE,
    ];

    public const MESSAGE_ZERO_DELTA = 'The qty delta field must not be zero.';

    public const MESSAGE_RECEIPT_SIGN = 'Stock in must add stock.';

    public const MESSAGE_WASTAGE_SIGN = 'Wastage must remove stock.';

    public const MESSAGE_UNIT_COST = 'Only stock in has a unit cost.';

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('adjustStock', $this->product()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $max = self::MAX_QTY;
        $type = $this->requestedType();

        $delta = ['bail', 'integer', "between:-{$max},{$max}"];
        $count = ['integer', "between:0,{$max}"];

        $quantities = match ($type) {
            StockMovement::TYPE_RECEIPT => [
                'qty_delta' => ['required', ...$delta, $this->sign(positive: true)],
                'counted_qty' => ['prohibited'],
            ],
            StockMovement::TYPE_WASTAGE => [
                'qty_delta' => ['required', ...$delta, $this->sign(positive: false)],
                'counted_qty' => ['prohibited'],
            ],
            StockMovement::TYPE_COUNT => [
                'qty_delta' => ['prohibited'],
                'counted_qty' => ['required', ...$count],
            ],
            default => [
                'qty_delta' => ['required_without:counted_qty', 'prohibits:counted_qty', 'nullable', ...$delta, $this->nonZero(...)],
                'counted_qty' => ['required_without:qty_delta', 'nullable', ...$count],
            ],
        };

        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'type' => ['sometimes', 'nullable', 'string', Rule::in(self::TYPES)],
            ...$quantities,
            'unit_cost_cents' => $type === StockMovement::TYPE_RECEIPT
                ? ['nullable', 'integer', 'between:0,'.self::MAX_UNIT_COST_CENTS]
                : ['prohibited'],
            'reason' => $type === StockMovement::TYPE_RECEIPT
                ? ['nullable', 'string', 'max:255']
                : ['required', 'string', 'max:255'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['unit_cost_cents.prohibited' => self::MESSAGE_UNIT_COST];
    }

    /**
     * `qty_delta` must not be zero (a count equal to the stock is reported by the action).
     */
    private function nonZero(string $attribute, mixed $value, Closure $fail): void
    {
        if ((int) $value === 0) {
            $fail(self::MESSAGE_ZERO_DELTA);
        }
    }

    /**
     * Stock in adds stock (≥ 1); wastage removes it (≤ −1).
     */
    private function sign(bool $positive): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($positive): void {
            if ($positive && (int) $value < 1) {
                $fail(self::MESSAGE_RECEIPT_SIGN);
            } elseif (! $positive && (int) $value > -1) {
                $fail(self::MESSAGE_WASTAGE_SIGN);
            }
        };
    }

    /**
     * The type the rules follow: the sent `type` when it is valid, else `adjustment` (an
     * invalid `type` has its own error).
     */
    private function requestedType(): string
    {
        $type = $this->input('type');

        return is_string($type) && in_array($type, self::TYPES, true) ? $type : StockMovement::TYPE_ADJUSTMENT;
    }

    public function product(): Product
    {
        /** @var Product */
        return $this->route('product');
    }

    /**
     * The validated type (`adjustment` when not sent).
     */
    public function type(): string
    {
        return (string) ($this->validated('type') ?? StockMovement::TYPE_ADJUSTMENT);
    }

    public function qtyDelta(): ?int
    {
        $value = $this->validated('qty_delta');

        return $value === null ? null : (int) $value;
    }

    public function countedQty(): ?int
    {
        $value = $this->validated('counted_qty');

        return $value === null ? null : (int) $value;
    }

    /**
     * The receipt's unit cost, or null when it wasn't sent (the product's cost applies).
     */
    public function unitCostCents(): ?int
    {
        $value = $this->validated('unit_cost_cents');

        return $value === null ? null : (int) $value;
    }

    public function reason(): ?string
    {
        $value = $this->validated('reason');

        return $value === null ? null : (string) $value;
    }
}
