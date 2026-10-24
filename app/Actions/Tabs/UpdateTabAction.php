<?php

namespace App\Actions\Tabs;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Tab;
use App\Models\User;
use App\Support\ModelChanges;
use Illuminate\Support\Facades\DB;

/**
 * Partially updates an open tab's `guests`, `customer_id` and `notes` (PATCH /api/v1/tabs/
 * {ulid}, Dine-in Tables & Tabs → D.3), under the tab's lock. Writes `tab.updated`
 * (`{ field: {from, to} }`) when something changed.
 */
class UpdateTabAction
{
    public function __construct(
        private readonly LockOpenTab $lockOpenTab,
        private readonly RecordAuditLog $recordAuditLog,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the fields sent)
     *
     * @throws ConflictException 409 when the tab isn't open
     */
    public function execute(Tab $tab, array $attributes, User $actor, ?string $ip = null): Tab
    {
        return DB::transaction(function () use ($tab, $attributes, $actor, $ip): Tab {
            $locked = $this->lockOpenTab->execute($tab);

            foreach (['guests', 'customer_id', 'notes'] as $field) {
                if (array_key_exists($field, $attributes)) {
                    $locked->setAttribute($field, $attributes[$field]);
                }
            }

            $changes = ModelChanges::diff($locked);

            if ($changes !== []) {
                $locked->save();

                $this->recordAuditLog->execute(
                    action: 'tab.updated',
                    actor: $actor,
                    subject: $locked,
                    changes: $changes,
                    ip: $ip,
                );
            }

            return $locked->refresh()->load(Tab::RESOURCE_RELATIONS);
        });
    }
}
