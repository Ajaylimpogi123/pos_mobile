<?php

namespace App\Http\Requests\Admin\Printing;

use App\Models\Printer;
use App\Models\User;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * POST /api/v1/admin/printers
 */
class StorePrinterRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', Printer::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return PrinterRules::rules(store: true, branchId: $this->caller()->branch_id);
    }

    /**
     * @return list<Closure>
     */
    public function after(): array
    {
        return [
            fn (Validator $validator) => PrinterRules::checkCashierRole(
                $validator,
                PrinterRules::validRole($this->input('role')),
                $this->all(),
            ),
        ];
    }

    public function caller(): User
    {
        /** @var User */
        return $this->user();
    }
}
