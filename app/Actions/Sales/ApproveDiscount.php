<?php

namespace App\Actions\Sales;

use App\Actions\Auth\VerifyPin;
use App\Exceptions\PinLockedException;
use App\Models\User;
use App\Support\Sales\PricedSale;
use Illuminate\Validation\ValidationException;

/**
 * Manager approval of a sale's discounts (Phase 3 contract, *Discount rules*), check 6
 * of POST /api/v1/orders.
 *
 * Approval is needed when `discount_cents > 0` and either the cashier lacks
 * `discount.apply` or `discount_cents × 100 > subtotal_cents × role.max_discount_percent`
 * (exact integers, over every discount on the order). The approver, sent in the same
 * request as `discount_authorization: { user_id, pin }`, must be active, in the cashier's
 * branch, have a PIN, have `discount.override`, and have a role limit that covers the
 * discount. The PIN goes through the shared PIN-attempt limiter (VerifyPin).
 *
 * When no approval is needed, `discount_authorization` is ignored (its PIN is not
 * checked) and there is no approver.
 *
 * SC/PWD is a legal entitlement and **never** needs approval: every check here uses the
 * regular discounts only (`line_discounts_cents + order discount`,
 * PricedSale::regularDiscountCents()), never the SC/PWD VAT relief or 20% discount. The
 * offline `discount_over_limit` flag uses the same figure.
 */
class ApproveDiscount
{
    public const MESSAGE_REQUIRED = 'A manager must approve this discount.';

    public const MESSAGE_NOT_APPROVER = "This person can't approve this discount.";

    public function __construct(private readonly VerifyPin $verifyPin) {}

    /**
     * Call it outside any DB transaction (the PIN attempt must stay counted).
     *
     * @param  array{user_id?: mixed, pin?: mixed}|null  $authorization  The validated `discount_authorization`
     * @return User|null The approver (`authorized_by`) when approval was needed, else null
     *
     * @throws ValidationException 422 on `discount_authorization`, `.user_id` or `.pin`
     * @throws PinLockedException 429
     */
    public function execute(User $cashier, PricedSale $sale, ?array $authorization): ?User
    {
        if (! self::isNeeded($cashier, $sale->subtotalCents, $sale->regularDiscountCents())) {
            return null;
        }

        if ($authorization === null) {
            throw ValidationException::withMessages(['discount_authorization' => self::MESSAGE_REQUIRED]);
        }

        // Soft-deleted users are excluded by the SoftDeletes scope.
        $approver = User::query()
            ->with('role.permissions')
            ->whereKey((int) $authorization['user_id'])
            ->where('branch_id', $cashier->branch_id)
            ->where('is_active', true)
            ->whereNotNull('pin_hash')
            ->first();

        if ($approver === null
            || ! $approver->hasPermission('discount.override')
            || ! self::withinLimit($approver, $sale->subtotalCents, $sale->regularDiscountCents())) {
            throw ValidationException::withMessages(['discount_authorization.user_id' => self::MESSAGE_NOT_APPROVER]);
        }

        $this->verifyPin->execute($approver, (string) $authorization['pin'], 'discount_authorization.pin');

        return $approver;
    }

    public static function isNeeded(User $cashier, int $subtotalCents, int $discountCents): bool
    {
        return $discountCents > 0
            && (! $cashier->hasPermission('discount.apply') || ! self::withinLimit($cashier, $subtotalCents, $discountCents));
    }

    /**
     * `discount × 100 ≤ subtotal × role.max_discount_percent`, in exact integers.
     */
    private static function withinLimit(User $user, int $subtotalCents, int $discountCents): bool
    {
        return $discountCents * 100 <= $subtotalCents * (int) $user->role?->max_discount_percent;
    }
}
