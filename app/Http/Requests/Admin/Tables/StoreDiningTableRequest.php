<?php

namespace App\Http\Requests\Admin\Tables;

use App\Models\DiningTable;
use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/tables (permission `settings.manage`). See DiningTableRules.
 */
class StoreDiningTableRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', DiningTable::class) ?? false;
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
        /** @var User $user */
        $user = $this->user();

        return DiningTableRules::rules(store: true, branchId: (int) $user->branch_id);
    }
}
