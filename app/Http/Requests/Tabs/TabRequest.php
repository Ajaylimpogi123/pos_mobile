<?php

namespace App\Http\Requests\Tabs;

use App\Exceptions\ConflictException;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\Tab;
use App\Models\User;
use App\Support\BranchSettings;
use App\Support\DineIn;
use Illuminate\Foundation\Http\FormRequest;
use LogicException;

/**
 * The tab endpoints of `/api/v1/tabs/{ulid}` (Dine-in Tables & Tabs → D). Every mutation is
 * idempotent (the `idempotent` middleware replays before this runs). Checked in this order:
 *
 * 1. `403` without `sale.create`;
 * 2. `409 "Dine-in tables are turned off in Settings."` while dine-in is off;
 * 3. `404` when the tab doesn't exist or belongs to another branch;
 * 4. the field rules (`422`), with the `Idempotency-Key` header as `idempotency_key`.
 *
 * Whether the tab is still `open` (`409 "This bill is already closed."`) is checked by the
 * action, under the tab's row lock.
 */
abstract class TabRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    private ?Tab $tab = null;

    private ?BranchSettings $settings = null;

    /**
     * Steps 1–3.
     *
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('create', Tab::class)) {
            return false;
        }

        $this->settings = DineIn::ensureEnabled($user);

        $this->tab = Tab::query()
            ->where('branch_id', $user->branch_id)
            ->where('ulid', strtoupper((string) $this->route('ulid')))
            ->firstOrFail();

        return $user->can('update', $this->tab);
    }

    /**
     * The tab of the `{ulid}` route.
     */
    public function tab(): Tab
    {
        return $this->tab ?? throw new LogicException('The tab is resolved by authorize().');
    }

    /**
     * The caller's branch settings (dine-in is on).
     */
    public function settings(): BranchSettings
    {
        return $this->settings ?? throw new LogicException('The settings are resolved by authorize().');
    }

    public function actor(): User
    {
        /** @var User */
        return $this->user();
    }
}
