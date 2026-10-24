<?php

namespace App\Support;

use App\Exceptions\ConflictException;
use App\Models\Branch;
use App\Models\User;

/**
 * The dine-in gate (Dine-in Tables & Tabs → A): while the branch setting `dine_in_enabled`
 * is off, the Tables view and every tab endpoint return `409`. The admin tables endpoints
 * are not gated, so tables can be set up first.
 */
final class DineIn
{
    public const MESSAGE_OFF = 'Dine-in tables are turned off in Settings.';

    /**
     * @throws ConflictException 409 when dine-in is off in the user's branch
     */
    public static function ensureEnabled(User $user): BranchSettings
    {
        $branch = Branch::query()->findOrFail($user->branch_id);
        $settings = BranchSettings::for($branch);

        if (! $settings->dineInEnabled()) {
            throw new ConflictException(self::MESSAGE_OFF);
        }

        return $settings;
    }
}
