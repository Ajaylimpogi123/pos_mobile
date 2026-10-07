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
        ];
    }
}
