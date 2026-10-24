<?php

namespace App\Actions\Tabs;

use App\Exceptions\ConflictException;
use App\Models\Tab;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Locks a tab's row (FOR UPDATE, inside the caller's transaction) and checks that it is still
 * `open`: actions 3–9 on a tab that isn't open are a `409 "This bill is already closed."`
 * (Dine-in Tables & Tabs → D). Every write to a tab and its lines goes through this lock.
 */
class LockOpenTab
{
    public const MESSAGE_CLOSED = 'This bill is already closed.';

    public const MESSAGE_CHANGED = 'This bill changed on another device. Review it again.';

    /**
     * @throws ConflictException
     */
    public function execute(Tab $tab): Tab
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('A tab must be locked inside a transaction.');
        }

        /** @var Tab $locked */
        $locked = Tab::query()->whereKey($tab->id)->lockForUpdate()->firstOrFail();

        self::ensureOpen($locked);

        return $locked;
    }

    /**
     * @throws ConflictException
     */
    public static function ensureOpen(Tab $tab): void
    {
        if (! $tab->isOpen()) {
            throw new ConflictException(self::MESSAGE_CLOSED);
        }
    }
}
