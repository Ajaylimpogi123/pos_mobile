<?php

namespace App\Http\Requests\Admin\Purchasing;

use Illuminate\Validation\Rule;

/**
 * The `Supplier` fields (Ingredients, Recipes & Purchasing → C): `name` (required, max 120,
 * unique among non-deleted suppliers, case-insensitively), `contact_person` (max 120),
 * `contact_number` (max 30), `email`, `address` (max 255), `is_active`. Every field but `name`
 * and `is_active` accepts null to clear it.
 */
trait SupplierRules
{
    /**
     * @return array<string, list<mixed>>
     */
    protected function supplierRules(bool $partial, ?int $ignoreId = null): array
    {
        $sometimes = $partial ? ['sometimes'] : [];

        return [
            'name' => [
                ...$sometimes, 'required', 'string', 'max:120',
                Rule::unique('suppliers', 'name')->whereNull('deleted_at')->ignore($ignoreId),
            ],
            'contact_person' => ['sometimes', 'nullable', 'string', 'max:120'],
            'contact_number' => ['sometimes', 'nullable', 'string', 'max:30'],
            'email' => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_active' => ['sometimes', 'required', 'boolean'],
        ];
    }
}
