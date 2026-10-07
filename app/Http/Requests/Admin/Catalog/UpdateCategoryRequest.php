<?php

namespace App\Http\Requests\Admin\Catalog;

use App\Models\Category;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/v1/admin/categories/{category}
 *
 * Partial update: only the fields sent are validated and changed. `name`,
 * `sort_order` and `is_active` cannot be null; `description` accepts null to clear it.
 */
class UpdateCategoryRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->category()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => [
                'sometimes', 'required', 'string', 'max:80',
                Rule::unique('categories', 'name')->whereNull('deleted_at')->ignore($this->category()->id),
            ],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'required', 'integer', 'min:0', 'max:65535'],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }

    public function category(): Category
    {
        /** @var Category */
        return $this->route('category');
    }
}
