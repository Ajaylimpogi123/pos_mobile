<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Models\Product;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/products
 *
 * Money fields must be JSON integers (`integer:strict`): "5000", "50.00" and 50.5 are rejected.
 */
class StoreProductRequest extends FormRequest
{
    public const MAX_CENTS = 100000000;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', Product::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            // A non-deleted category; it may be inactive.
            'category_id' => ['bail', 'required', 'integer', Rule::exists('categories', 'id')->whereNull('deleted_at')],
            'name' => ['required', 'string', 'max:120'],
            // Unique among non-deleted products; the _ci collation makes it case-insensitive.
            'sku' => ['sometimes', 'nullable', 'string', 'max:50', 'alpha_dash', Rule::unique('products', 'sku')->whereNull('deleted_at')],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'price_cents' => ['required', 'integer:strict', 'min:0', 'max:'.self::MAX_CENTS],
            'cost_cents' => ['sometimes', 'required', 'integer:strict', 'min:0', 'max:'.self::MAX_CENTS],
            'is_vatable' => ['sometimes', 'required', 'boolean'],
            'is_available' => ['sometimes', 'required', 'boolean'],
            'track_stock' => ['sometimes', 'required', 'boolean'],
            // Round B: `own`, `recipe` or `none` (default `none`).
            'stock_mode' => ['sometimes', 'required', 'string', Rule::in(Product::STOCK_MODES)],
            'sort_order' => ['sometimes', 'required', 'integer', 'min:0', 'max:65535'],
        ];
    }

    /**
     * The validated attributes. `track_stock` (kept for existing clients) maps onto `stock_mode`
     * (Product model); when both are sent, `stock_mode` wins.
     *
     * @return array<string, mixed>
     */
    public function productAttributes(): array
    {
        return self::withStockMode($this->validated());
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    public static function withStockMode(array $attributes): array
    {
        if (array_key_exists('stock_mode', $attributes)) {
            unset($attributes['track_stock']);
        }

        return $attributes;
    }
}
