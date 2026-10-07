<?php

namespace App\Http\Requests\Admin\Printing;

use App\Models\Printer;
use App\Rules\PrinterHost;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Field rules shared by the admin printer endpoints (contract: Printing, Phase 4).
 * On store every field except `name`, `role` and `host` is optional; on update every
 * field is optional (partial PATCH). No field accepts `null`.
 */
final class PrinterRules
{
    public const MESSAGE_CASHIER_DEFAULT = 'Only a kitchen or bar printer can be the default kitchen printer.';

    public const MESSAGE_CASHIER_CATEGORIES = "Receipt printers don't take categories.";

    /**
     * @return array<string, list<mixed>>
     */
    public static function rules(bool $store, int $branchId, ?Printer $ignore = null): array
    {
        $required = $store ? ['required'] : ['sometimes', 'required'];

        // Unique per branch among non-deleted printers; the _ci collation makes it case-insensitive.
        $uniqueName = Rule::unique('printers', 'name')->where('branch_id', $branchId)->whereNull('deleted_at');

        if ($ignore !== null) {
            $uniqueName->ignore($ignore->id);
        }

        return [
            'name' => ['bail', ...$required, 'string', 'max:40', $uniqueName],
            'role' => ['bail', ...$required, 'string', Rule::in(Printer::ROLES)],
            'host' => ['bail', ...$required, 'string', 'max:253', new PrinterHost],
            'port' => ['sometimes', 'required', 'integer', 'min:1', 'max:65535'],
            'paper_width_mm' => ['bail', 'sometimes', 'required', 'integer', Rule::in(Printer::PAPER_WIDTHS)],
            'is_enabled' => ['sometimes', 'required', 'boolean'],
            'is_default_kitchen' => ['sometimes', 'required', 'boolean'],
            // `required` would reject an empty list, which clears the routes.
            'category_ids' => ['sometimes', 'array'],
            // A non-deleted category; it may be inactive.
            'category_ids.*' => ['bail', 'integer', 'distinct', Rule::exists('categories', 'id')->whereNull('deleted_at')],
        ];
    }

    /**
     * The cross-field rules for the printer's role after the write (`$role`, or null when
     * the role is unknown because it failed validation): a cashier printer cannot be the
     * default kitchen printer and cannot take categories.
     *
     * @param  array<string, mixed>  $input
     */
    public static function checkCashierRole(Validator $validator, ?string $role, array $input): void
    {
        if ($role !== Printer::ROLE_CASHIER) {
            return;
        }

        $errors = $validator->errors();

        if (
            array_key_exists('is_default_kitchen', $input)
            && ! $errors->has('is_default_kitchen')
            && filter_var($input['is_default_kitchen'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === true
        ) {
            $errors->add('is_default_kitchen', self::MESSAGE_CASHIER_DEFAULT);
        }

        if (
            array_key_exists('category_ids', $input)
            && ! $errors->has('category_ids')
            && is_array($input['category_ids'])
            && $input['category_ids'] !== []
        ) {
            $errors->add('category_ids', self::MESSAGE_CASHIER_CATEGORIES);
        }
    }

    /**
     * A sent role that passed its own rules, or null.
     */
    public static function validRole(mixed $role): ?string
    {
        return is_string($role) && in_array($role, Printer::ROLES, true) ? $role : null;
    }
}
