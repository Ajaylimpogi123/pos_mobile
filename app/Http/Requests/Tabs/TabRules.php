<?php

namespace App\Http\Requests\Tabs;

use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

/**
 * Field rules shared by the tab requests (Dine-in Tables & Tabs → D).
 */
final class TabRules
{
    public const MAX_GUESTS = 99;

    public const MAX_NOTES = 255;

    /**
     * An active, non-deleted table of the branch.
     */
    public static function activeTable(int $branchId): Exists
    {
        return Rule::exists('dining_tables', 'id')
            ->where('branch_id', $branchId)
            ->where('is_active', true)
            ->whereNull('deleted_at');
    }

    /**
     * An existing, non-deleted customer.
     */
    public static function customer(): Exists
    {
        return Rule::exists('customers', 'id')->whereNull('deleted_at');
    }
}
