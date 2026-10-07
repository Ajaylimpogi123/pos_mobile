<?php

namespace App\Http\Requests\Admin\Purchasing;

use App\Models\Supplier;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/suppliers/{supplier} (permission `supplier.manage`). Partial update: only
 * the fields sent are validated and changed.
 */
class UpdateSupplierRequest extends FormRequest
{
    use SupplierRules;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->supplier()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->supplierRules(partial: true, ignoreId: $this->supplier()->id);
    }

    public function supplier(): Supplier
    {
        /** @var Supplier */
        return $this->route('supplier');
    }
}
