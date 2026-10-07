<?php

namespace App\Http\Requests\Purchasing;

use App\Actions\Purchasing\GoodsReceiptLineInput;
use App\Actions\Purchasing\PurchaseItemResolver;
use App\Actions\Purchasing\ResolvedQuantity;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Rules\DecimalQuantity;
use App\Support\Quantity;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * POST /api/v1/purchase-orders/{purchaseOrder}/receipts (`purchase.receive`; idempotent,
 * `Idempotency-Key` = the body's `ulid`): `{ ulid, remarks?, lines: [{ po_line_id, qty, unit,
 * reason? }] (1..100) }`.
 *
 * - `po_line_id`: one of this PO's lines, each at most once;
 * - `qty`: not 0, at most 3 decimals and 1,000,000 in size; negative is a correction and needs a
 *   `reason` (max 255): `Give a reason for the correction.` (provisional, Q-030);
 * - `unit`: the line's unit, or another unit valid for its item.
 *
 * Whether the line's received total stays at or above 0 is checked under the lock by the action.
 */
class StoreGoodsReceiptRequest extends FormRequest
{
    use PurchaseOrderLineInput;
    use ValidatesIdempotencyKey;

    public const MESSAGE_CORRECTION_REASON = 'Give a reason for the correction.';

    /**
     * @var list<GoodsReceiptLineInput>
     */
    private array $resolvedLines = [];

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('receive', $this->purchaseOrder()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'remarks' => ['sometimes', 'nullable', 'string', 'max:500'],
            'lines' => ['required', 'array', 'min:1', 'max:100'],
            'lines.*' => ['array'],
            'lines.*.po_line_id' => [
                'required', 'integer', 'distinct',
                Rule::exists('purchase_order_lines', 'id')->where('purchase_order_id', $this->purchaseOrder()->id),
            ],
            'lines.*.qty' => ['required', new DecimalQuantity(allowNegative: true)],
            'lines.*.unit' => ['required', 'string', 'max:20'],
            'lines.*.reason' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            $lines = $this->input('lines');

            if (! is_array($lines) || $validator->errors()->has('lines')) {
                return;
            }

            $existing = $this->purchaseOrder()->lines()->with(['ingredient', 'product'])->get()->keyBy('id');
            $resolver = new PurchaseItemResolver;
            $resolved = [];

            foreach (array_values($lines) as $i => $input) {
                if (collect(['po_line_id', 'qty', 'unit', 'reason'])->contains(fn (string $field) => $validator->errors()->has("lines.{$i}.{$field}"))) {
                    continue;
                }

                /** @var PurchaseOrderLine $line */
                $line = $existing->get((int) $input['po_line_id']);
                $qty = (string) Quantity::parseInput($input['qty']);
                $reason = isset($input['reason']) && $input['reason'] !== '' ? (string) $input['reason'] : null;

                if (str_starts_with($qty, '-') && $reason === null) {
                    $validator->errors()->add("lines.{$i}.reason", self::MESSAGE_CORRECTION_REASON);

                    continue;
                }

                $quantity = $this->lineQuantity($resolver, $line, $qty, (string) $input['unit']);

                if (! $quantity instanceof ResolvedQuantity) {
                    $validator->errors()->add("lines.{$i}.{$quantity[0]}", $quantity[1]);

                    continue;
                }

                $resolved[] = new GoodsReceiptLineInput($i, $line->id, $quantity, $reason);
            }

            $this->resolvedLines = $resolved;
        }];
    }

    public function purchaseOrder(): PurchaseOrder
    {
        /** @var PurchaseOrder */
        return $this->route('purchaseOrder');
    }

    public function remarks(): ?string
    {
        $value = $this->validated('remarks');

        return $value === null || $value === '' ? null : (string) $value;
    }

    /**
     * @return list<GoodsReceiptLineInput>
     */
    public function receiptLines(): array
    {
        return $this->resolvedLines;
    }
}
