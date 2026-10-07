<?php

namespace App\Http\Requests\Admin\Printing;

use App\Models\Printer;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * PATCH /api/v1/admin/printers/{printer}
 *
 * Partial update: only the fields sent are validated and changed; none accepts null.
 * The cashier checks use the role the printer will have after the write (the sent role,
 * or the current one).
 */
class UpdatePrinterRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->printer()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return PrinterRules::rules(store: false, branchId: $this->printer()->branch_id, ignore: $this->printer());
    }

    /**
     * @return list<Closure>
     */
    public function after(): array
    {
        return [
            fn (Validator $validator) => PrinterRules::checkCashierRole(
                $validator,
                $this->has('role') ? PrinterRules::validRole($this->input('role')) : $this->printer()->role,
                $this->all(),
            ),
        ];
    }

    public function printer(): Printer
    {
        /** @var Printer */
        return $this->route('printer');
    }
}
