<?php

namespace App\Actions\Printing;

use App\Actions\Audit\RecordAuditLog;
use App\Exceptions\ConflictException;
use App\Models\Branch;
use App\Models\Setting;
use App\Models\Tab;
use App\Models\User;
use App\Support\BranchSettings;
use Illuminate\Support\Facades\DB;

/**
 * Applies a partial update to the caller's branch settings (PATCH /admin/settings).
 *
 * Only the keys sent are considered, and only the ones whose value actually differs from
 * the current value (the saved one or the default) are saved and written to the
 * `settings.updated` audit entry (`{ key: { from, to } }`, subject: the branch). A request
 * that changes nothing writes nothing, so `updated_at` stays `null` until a first real
 * change. The branch row is locked so concurrent saves are serialised.
 */
class UpdateBranchSettingsAction
{
    public const MESSAGE_OPEN_TABS = 'Close the %d open bills first.';

    public const MESSAGE_OPEN_TAB = 'Close the 1 open bill first.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @param  array<string, mixed>  $attributes  Validated input (only the keys sent)
     */
    public function execute(Branch $branch, array $attributes, User $actor, ?string $ip = null): BranchSettings
    {
        return DB::transaction(function () use ($branch, $attributes, $actor, $ip): BranchSettings {
            Branch::query()->whereKey($branch->id)->lockForUpdate()->first();

            $current = BranchSettings::for($branch);
            $changes = [];

            foreach (BranchSettings::KEYS as $key) {
                if (! array_key_exists($key, $attributes)) {
                    continue;
                }

                $value = $this->normalise($key, $attributes[$key]);

                if ($value === $current->get($key)) {
                    continue;
                }

                // Dine-in Tables & Tabs → A: dine-in can't be turned off while tabs are open.
                if ($key === BranchSettings::DINE_IN_ENABLED && $value === false) {
                    $this->assertNoOpenTabs($branch);
                }

                $changes[$key] = ['from' => $current->get($key), 'to' => $value];

                $setting = Setting::query()->firstOrNew(['branch_id' => $branch->id, 'key' => $key]);
                $setting->value = $value;
                $setting->forceFill([
                    'created_by' => $setting->exists ? $setting->created_by : $actor->id,
                    'updated_by' => $actor->id,
                    'updated_at' => $setting->freshTimestamp(),
                ])->save();
            }

            if ($changes !== []) {
                $this->recordAuditLog->execute(
                    action: 'settings.updated',
                    actor: $actor,
                    subject: $branch,
                    changes: $changes,
                    ip: $ip,
                );
            }

            return BranchSettings::for($branch);
        });
    }

    /**
     * @throws ConflictException 409 while the branch has open tabs
     */
    private function assertNoOpenTabs(Branch $branch): void
    {
        $open = Tab::query()->where('branch_id', $branch->id)->where('status', Tab::STATUS_OPEN)->count();

        if ($open > 0) {
            throw new ConflictException($open === 1 ? self::MESSAGE_OPEN_TAB : sprintf(self::MESSAGE_OPEN_TABS, $open));
        }
    }

    /**
     * The validated value as stored: lines as a list of strings, flags as booleans,
     * copies and the service charge as integers.
     */
    private function normalise(string $key, mixed $value): mixed
    {
        return match ($key) {
            BranchSettings::RECEIPT_HEADER_LINES, BranchSettings::RECEIPT_FOOTER_LINES => array_values(array_map('strval', $value)),
            BranchSettings::AUTO_PRINT_RECEIPT, BranchSettings::PRINT_KITCHEN_TICKETS, BranchSettings::DINE_IN_ENABLED => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            BranchSettings::RECEIPT_COPIES, BranchSettings::SERVICE_CHARGE_BPS, BranchSettings::RESERVATION_HOLD_MINUTES => (int) $value,
            default => $value,
        };
    }
}
