<?php

namespace App\Http\Requests\Admin\Printing;

use App\Models\Setting;
use App\Support\BranchSettings;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/settings (permission `settings.manage`).
 *
 * Partial update: only the keys sent are validated and changed; none accepts null.
 * An empty list of header or footer lines is allowed (nothing is printed there).
 */
class UpdateBranchSettingsRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', Setting::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $lines = ['sometimes', 'array', 'max:'.BranchSettings::MAX_LINES];
        $line = ['required', 'string', 'max:'.BranchSettings::MAX_LINE_LENGTH];

        return [
            BranchSettings::RECEIPT_HEADER_LINES => $lines,
            BranchSettings::RECEIPT_HEADER_LINES.'.*' => $line,
            BranchSettings::RECEIPT_FOOTER_LINES => $lines,
            BranchSettings::RECEIPT_FOOTER_LINES.'.*' => $line,
            BranchSettings::AUTO_PRINT_RECEIPT => ['sometimes', 'required', 'boolean'],
            BranchSettings::RECEIPT_COPIES => [
                'sometimes', 'required', 'integer', 'min:'.BranchSettings::MIN_COPIES, 'max:'.BranchSettings::MAX_COPIES,
            ],
            BranchSettings::PRINT_KITCHEN_TICKETS => ['sometimes', 'required', 'boolean'],
            // Dine-in Tables & Tabs → A.
            BranchSettings::DINE_IN_ENABLED => ['sometimes', 'required', 'boolean'],
            BranchSettings::SERVICE_CHARGE_BPS => [
                'sometimes', 'required', 'integer', 'min:0', 'max:'.BranchSettings::MAX_SERVICE_CHARGE_BPS,
            ],
            // Table Management → A (TM2).
            BranchSettings::RESERVATION_HOLD_MINUTES => [
                'sometimes', 'required', 'integer', 'min:0', 'max:'.BranchSettings::MAX_RESERVATION_HOLD_MINUTES,
            ],
        ];
    }
}
