<?php

namespace App\Actions\Sync;

use App\Models\Customer;
use App\Models\Product;
use App\Models\Shift;
use App\Models\User;
use App\Support\Ulid;
use Illuminate\Database\Eloquent\Collection;

/**
 * The reference data of one POST /api/v1/sync/orders batch, shared by its orders so that
 * a batch of up to 50 sales does not repeat the same lookups:
 *
 * - the products of every submitted line, loaded up front with **one** query
 *   (soft-deleted included, with their category);
 * - the cashier lookup, memoised by `cashier_id` (a failed lookup too);
 * - the customer existence check, memoised by `customer_id`;
 * - the shifts of every submitted `shift_ulid` (Phase 6), loaded up front with **one** query.
 *
 * One instance per request (built by IngestOfflineOrdersAction), never static, so nothing
 * is shared between requests. The data only feeds reads made before each order's own
 * transaction, exactly as the per-order lookups did.
 */
final class OfflineOrderBatch
{
    /**
     * @var array<int, User|null>
     */
    private array $cashiers = [];

    /**
     * @var array<int, bool>
     */
    private array $customers = [];

    /**
     * The products found so far, keyed by id.
     *
     * @var Collection<int, Product>
     */
    private Collection $products;

    /**
     * Every product id already looked up, found or not.
     *
     * @var array<int, true>
     */
    private array $lookedUp = [];

    /**
     * The shifts of the batch's `shift_ulid`s (Phase 6), keyed by ULID, any branch.
     *
     * @var array<string, Shift>
     */
    private array $shifts = [];

    /**
     * Every shift ULID already looked up, found or not.
     *
     * @var array<string, true>
     */
    private array $shiftsLookedUp = [];

    private function __construct()
    {
        $this->products = new Collection;
    }

    /**
     * Loads the products of every line of the submitted orders in one query. Values that
     * aren't integers are skipped (those orders fail their own validation).
     *
     * @param  array<array-key, mixed>  $orders  The request's `orders`, not yet validated
     */
    public static function for(array $orders): self
    {
        $ids = [];
        $shiftUlids = [];

        foreach ($orders as $order) {
            if (is_array($order) && Ulid::isValid($order['shift_ulid'] ?? null)) {
                $shiftUlids[$order['shift_ulid']] = true;
            }

            if (! is_array($order) || ! is_array($order['items'] ?? null)) {
                continue;
            }

            foreach ($order['items'] as $item) {
                $id = is_array($item) ? filter_var($item['product_id'] ?? null, FILTER_VALIDATE_INT) : false;

                if ($id !== false) {
                    $ids[$id] = true;
                }
            }
        }

        $batch = new self;
        $batch->remember(array_keys($ids), self::loadProducts(array_keys($ids)));
        $batch->loadShifts(array_map('strval', array_keys($shiftUlids)));

        return $batch;
    }

    /**
     * The shift with this ULID when the branch knows it (Phase 6), else null. Loaded up
     * front for the whole batch; a ULID not seen then is looked up now.
     */
    public function shift(string $ulid, int $branchId): ?Shift
    {
        if (! isset($this->shiftsLookedUp[$ulid])) {
            $this->loadShifts([$ulid]);
        }

        $shift = $this->shifts[$ulid] ?? null;

        return $shift !== null && $shift->branch_id === $branchId ? $shift : null;
    }

    /**
     * @param  list<string>  $ulids
     */
    private function loadShifts(array $ulids): void
    {
        if ($ulids === []) {
            return;
        }

        foreach ($ulids as $ulid) {
            $this->shiftsLookedUp[$ulid] = true;
        }

        foreach (Shift::query()->whereIn('ulid', $ulids)->get() as $shift) {
            $this->shifts[$shift->ulid] = $shift;
        }
    }

    /**
     * The products with these ids that exist (soft-deleted included), keyed by id. An id
     * not loaded up front is loaded now, so the result never depends on the preload.
     *
     * @param  list<int>  $ids
     * @return Collection<int, Product>
     */
    public function products(array $ids): Collection
    {
        $ids = array_values(array_unique($ids));
        $notLookedUp = array_values(array_filter($ids, fn (int $id) => ! isset($this->lookedUp[$id])));

        if ($notLookedUp !== []) {
            $this->remember($notLookedUp, self::loadProducts($notLookedUp));
        }

        // Not Eloquent's only(): it re-indexes, and callers read the products by id.
        return new Collection(array_intersect_key($this->products->all(), array_flip($ids)));
    }

    /**
     * The cashier signed in at sale time: an active, non-deleted user of the caller's
     * branch with `sale.create` (role and permissions loaded), or null. Memoised by id.
     */
    public function cashier(int $cashierId, User $caller): ?User
    {
        if (array_key_exists($cashierId, $this->cashiers)) {
            return $this->cashiers[$cashierId];
        }

        $cashier = User::query()
            ->with('role.permissions')
            ->whereKey($cashierId)
            ->where('branch_id', $caller->branch_id)
            ->where('is_active', true)
            ->first();

        return $this->cashiers[$cashierId] = $cashier !== null && $cashier->hasPermission('sale.create') ? $cashier : null;
    }

    /**
     * Whether a customer with this id ever existed (soft-deleted included). Memoised by id.
     */
    public function customerExists(int $customerId): bool
    {
        return $this->customers[$customerId] ??= Customer::withTrashed()->whereKey($customerId)->exists();
    }

    /**
     * @param  list<int>  $ids  The ids looked up
     * @param  Collection<int, Product>  $found  The products found, keyed by id
     */
    private function remember(array $ids, Collection $found): void
    {
        foreach ($ids as $id) {
            $this->lookedUp[$id] = true;
        }

        foreach ($found as $id => $product) {
            $this->products->put($id, $product);
        }
    }

    /**
     * @param  list<int>  $ids
     * @return Collection<int, Product>
     */
    private static function loadProducts(array $ids): Collection
    {
        if ($ids === []) {
            return new Collection;
        }

        return Product::withTrashed()->with('category')->whereKey($ids)->get()->keyBy('id');
    }
}
