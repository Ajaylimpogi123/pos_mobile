<?php

namespace App\Http\Requests\Admin\Tables;

use App\Models\DiningTable;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/tables/{diningTable} (permission `settings.manage`). Partial update:
 * only the fields sent are validated and changed. See DiningTableRules.
 */
class UpdateDiningTableRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->diningTable()) ?? false;
    }

    protected function prepareForValidation(): void
    {
        DiningTableRules::prepare($this);
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $table = $this->diningTable();

        return DiningTableRules::rules(store: false, branchId: $table->branch_id, ignore: $table);
    }

    public function diningTable(): DiningTable
    {
        /** @var DiningTable */
        return $this->route('diningTable');
    }
}
