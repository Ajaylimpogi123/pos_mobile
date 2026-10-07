<?php

namespace App\Http\Requests\Shifts;

use App\Actions\Shifts\OpenShiftAction;
use App\Exceptions\ConflictException;
use App\Http\Requests\Sync\OfflineOrderRules;
use App\Http\Requests\Sync\SyncOrdersRequest;
use App\Models\Device;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;
use LogicException;

/**
 * The shift writes (Phase 6): open, cash movement, close. Each is an event the tablet made,
 * possibly offline, so it is checked in this order:
 *
 * 1. `403` without the permission (checked before validation);
 * 2. `409 "Register this tablet first."` when the token isn't bound to a device of the
 *    caller's branch (as POST /sync/orders);
 * 3. for the endpoints on `{ulid}`: `404` for a shift the caller's branch doesn't know, and
 *    `409 "This shift belongs to another tablet."` for another device's shift;
 * 4. the field rules (`422`). The users named in the body must be active, non-deleted users
 *    of the caller's branch, except on a repeat, which gets the stored result (Q-012).
 */
abstract class ShiftEventRequest extends FormRequest
{
    private ?Device $device = null;

    private ?Shift $shift = null;

    /**
     * Steps 1 and 2.
     *
     * @throws ConflictException 409 without a device
     */
    protected function authorizeOnDevice(string $ability): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can($ability, Shift::class)) {
            return false;
        }

        $this->device = Device::ofSession($user) ?? throw new ConflictException(SyncOrdersRequest::MESSAGE_NO_DEVICE);

        return true;
    }

    /**
     * Step 3, for the endpoints on `{ulid}`.
     *
     * @throws ConflictException 409 for another device's shift
     */
    protected function resolveShift(): void
    {
        /** @var User $user */
        $user = $this->user();

        $shift = Shift::query()
            ->where('branch_id', $user->branch_id)
            ->where('ulid', strtoupper((string) $this->route('ulid')))
            ->firstOrFail();

        if ($shift->device_id !== $this->device()->id) {
            throw new ConflictException(OpenShiftAction::MESSAGE_OTHER_TABLET);
        }

        $this->shift = $shift;
    }

    /**
     * The device the caller's token is bound to.
     */
    public function device(): Device
    {
        return $this->device ?? throw new ConflictException(SyncOrdersRequest::MESSAGE_NO_DEVICE);
    }

    /**
     * The shift of the `{ulid}` endpoints.
     */
    public function shift(): Shift
    {
        return $this->shift ?? throw new LogicException('The shift is resolved by authorize().');
    }

    /**
     * An ISO 8601 time with a `Z` or `±HH:MM` offset (as the offline `placed_at`).
     *
     * @return list<string>
     */
    protected static function instantRules(): array
    {
        return ['required', 'string', 'regex:'.OfflineOrderRules::PLACED_AT_PATTERN, 'date'];
    }

    /**
     * A user named in the body: an integer id and, unless this is a repeat, an active,
     * non-deleted user of the caller's branch.
     *
     * @return list<mixed>
     */
    protected function branchUserRules(bool $isRepeat): array
    {
        return ['bail', 'required', 'integer', ...($isRepeat ? [] : [$this->activeBranchUser()])];
    }

    private function activeBranchUser(): Exists
    {
        /** @var User $user */
        $user = $this->user();

        return Rule::exists('users', 'id')
            ->where('branch_id', $user->branch_id)
            ->where('is_active', true)
            ->whereNull('deleted_at');
    }
}
