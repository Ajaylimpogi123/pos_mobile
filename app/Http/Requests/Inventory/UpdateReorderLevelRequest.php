<?php

namespace App\Http\Requests\Inventory;

use App\Models\Product;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PUT /api/v1/inventory/{product}/reorder-level (Inventory, v1 completion; permission
 * `inventory.adjust`): `reorder_level` (present, nullable, integer, 0 to 100000). `null`
 * turns the low-stock alert off.
 */
class UpdateReorderLevelRequest extends FormRequest
{
    public const MAX_REORDER_LEVEL = 100000;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('setReorderLevel', $this->product()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'reorder_level' => ['present', 'nullable', 'integer', 'between:0,'.self::MAX_REORDER_LEVEL],
        ];
    }

    public function product(): Product
    {
        /** @var Product */
        return $this->route('product');
    }

    public function reorderLevel(): ?int
    {
        $value = $this->validated('reorder_level');

        return $value === null ? null : (int) $value;
    }
}
