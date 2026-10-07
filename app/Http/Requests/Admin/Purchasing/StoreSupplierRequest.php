<?php

namespace App\Http\Requests\Admin\Purchasing;

use App\Models\Supplier;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/suppliers (permission `supplier.manage`).
 */
class StoreSupplierRequest extends FormRequest
{
    use SupplierRules;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', Supplier::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->supplierRules(partial: false);
    }
}
