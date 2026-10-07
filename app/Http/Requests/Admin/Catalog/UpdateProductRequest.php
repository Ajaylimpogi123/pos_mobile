<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Models\Product;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/products/{product}
 *
 * Partial update: only the fields sent are validated and changed. `sku` and
 * `description` accept null to clear them; every other field cannot be null.
 * Money fields must be JSON integers (`integer:strict`).
 */
class UpdateProductRequest extends FormRequest
{
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
        $maxCents = 'max:'.StoreProductRequest::MAX_CENTS;

        return [
            'category_id' => ['bail', 'sometimes', 'required', 'integer', Rule::exists('categories', 'id')->whereNull('deleted_at')],
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'sku' => [
                'sometimes', 'nullable', 'string', 'max:50', 'alpha_dash',
                Rule::unique('products', 'sku')->whereNull('deleted_at')->ignore($this->product()->id),
            ],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'price_cents' => ['sometimes', 'required', 'integer:strict', 'min:0', $maxCents],
            'cost_cents' => ['sometimes', 'required', 'integer:strict', 'min:0', $maxCents],
            'is_vatable' => ['sometimes', 'required', 'boolean'],
            'is_available' => ['sometimes', 'required', 'boolean'],
            'track_stock' => ['sometimes', 'required', 'boolean'],
            // Round B; the switching rules (409) are UpdateProductAction's.
            'stock_mode' => ['sometimes', 'required', 'string', Rule::in(Product::STOCK_MODES)],
            'sort_order' => ['sometimes', 'required', 'integer', 'min:0', 'max:65535'],
        ];
    }

    /**
     * The validated attributes, `stock_mode` winning over `track_stock` when both are sent.
     *
     * @return array<string, mixed>
     */
    public function productAttributes(): array
    {
        return StoreProductRequest::withStockMode($this->validated());
    }

    public function product(): Product
    {
        /** @var Product */
        return $this->route('product');
    }
}
