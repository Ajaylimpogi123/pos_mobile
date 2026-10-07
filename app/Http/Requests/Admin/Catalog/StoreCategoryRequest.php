<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Models\Category;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/admin/categories
 */
class StoreCategoryRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', Category::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            // Unique among non-deleted categories; the _ci collation makes it case-insensitive.
            'name' => ['required', 'string', 'max:80', Rule::unique('categories', 'name')->whereNull('deleted_at')],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'required', 'integer', 'min:0', 'max:65535'],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
