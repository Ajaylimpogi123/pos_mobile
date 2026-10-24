<?php

namespace App\Actions\Dashboard;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * The dashboard `insights`: the contract's rules (seven from Phase 1c, plus
 * `orders_need_review` from Phase 5, which needs the `sales` section, and `stock_out` /
 * `stock_low` from Inventory, which need `inventory.adjust` or `report.view`), evaluated only
 * over the sections the caller can see (a hidden section is `null` here), each emitted only
 * when its count is above zero, ordered critical → warning → info, then by key.
 */
class BuildInsights
{
    private const SEVERITY_ORDER = ['critical' => 0, 'warning' => 1, 'info' => 2];

    /**
     * @param  array<string, mixed>|null  $catalog  including `low_margin_count`
     * @param  array<string, mixed>|null  $staff
     * @param  int|null  $ordersNeedingReview  The branch's orders with `needs_review` (Phase 5);
     *                                         null when the `sales` section is hidden
     * @param  array{low: int, out: int}|null  $stock  The branch's tracked products by stock status
     *                                                 (Inventory); null without `inventory.adjust`
     *                                                 or `report.view`
     * @param  array{low: int, out: int}|null  $ingredients  The branch's ingredients by stock status;
     *                                                       null without `inventory.adjust` or `report.view`
     * @param  array{requests_pending?: int, orders_pending?: int, orders_to_receive?: int}  $purchasing
     *                                                                                                    The purchasing queues the caller may act on
     * @param  list<array{code: string, outbox_pending: int, last_seen_at: CarbonInterface|null}>|null  $unsyncedDevices
     *                                                                                                                    Hardening & Pilot → C; null without `system.manage`
     * @return list<array{key: string, severity: string, title: string, message: string, count: int, action: string|null}>
     */
    public function execute(?array $catalog, ?array $staff, ?int $ordersNeedingReview = null, ?array $stock = null, ?array $ingredients = null, array $purchasing = [], ?array $unsyncedDevices = null, ?CarbonInterface $now = null): array
    {
        $insights = [];

        // Hardening & Pilot → C: active tablets whose last heartbeat (over 30 min ago) reported
        // unsynced sales; only for `system.manage` holders. One insight; `count` is the number
        // of devices. Wording for several devices confirmed (Q-044).
        if ($unsyncedDevices !== null && $unsyncedDevices !== []) {
            $now ??= Carbon::now();
            $first = $unsyncedDevices[0];
            $one = count($unsyncedDevices) === 1;

            $insights[] = $this->insight(
                'device_unsynced', 'warning', 'settings.devices', count($unsyncedDevices),
                fn (int $n) => $one
                    ? sprintf('%s has %s (last seen %s)', $first['code'], $this->count($first['outbox_pending'], 'unsynced sale', 'unsynced sales'), $this->ago($first['last_seen_at'], $now))
                    : $this->count($n, 'tablet has', 'tablets have').' unsynced sales',
                'Bring these tablets online so their sales sync before anything is lost.',
            );
        }

        // Ingredients, Recipes & Purchasing: the ingredient alerts (with `inventory.adjust` or
        // `report.view`) and the purchasing queues (`purchase.approve` / `purchase.receive`).
        // Messages provisional (Q-030); action keys per Q-029.
        if ($ingredients !== null) {
            $insights[] = $this->insight(
                'ingredients_out', 'critical', 'inventory.ingredients.alerts', (int) $ingredients['out'],
                fn (int $n) => $this->count($n, 'ingredient is', 'ingredients are').' out of stock',
                'Receive or count these ingredients.',
            );
            $insights[] = $this->insight(
                'ingredients_low', 'warning', 'inventory.ingredients.alerts', (int) $ingredients['low'],
                fn (int $n) => $this->count($n, 'ingredient is', 'ingredients are').' running low',
                'Request these ingredients before they run out.',
            );
        }

        if (isset($purchasing['requests_pending'])) {
            $insights[] = $this->insight(
                'purchase_requests_pending', 'warning', 'purchasing.requests.pending', (int) $purchasing['requests_pending'],
                fn (int $n) => $this->count($n, 'purchase request needs', 'purchase requests need').' a decision',
                'Approve or decline the items of these requests.',
            );
        }

        if (isset($purchasing['orders_pending'])) {
            $insights[] = $this->insight(
                'purchase_orders_pending', 'warning', 'purchasing.orders.pending', (int) $purchasing['orders_pending'],
                fn (int $n) => $this->count($n, 'purchase order is', 'purchase orders are').' waiting for approval',
                'Approve or decline these orders.',
            );
        }

        if (isset($purchasing['orders_to_receive'])) {
            $insights[] = $this->insight(
                'purchase_orders_to_receive', 'info', 'purchasing.orders.to_receive', (int) $purchasing['orders_to_receive'],
                fn (int $n) => $this->count($n, 'purchase order is', 'purchase orders are').' ready for receiving',
                'Record the deliveries when they arrive.',
            );
        }

        if ($stock !== null) {
            // Messages provisional (Q-022).
            $insights[] = $this->insight(
                'stock_out', 'critical', 'inventory.alerts', (int) $stock['out'],
                fn (int $n) => $this->count($n, 'product is', 'products are').' out of stock',
                'Stock in these products or mark them unavailable.',
            );
            $insights[] = $this->insight(
                'stock_low', 'warning', 'inventory.alerts', (int) $stock['low'],
                fn (int $n) => $this->count($n, 'product is', 'products are').' running low',
                'Reorder these products before they run out.',
            );
        }

        if ($ordersNeedingReview !== null) {
            // Message and singular title provisional (Q-009).
            $insights[] = $this->insight(
                'orders_need_review', 'warning', 'orders.review', $ordersNeedingReview,
                fn (int $n) => $this->count($n, 'offline sale needs', 'offline sales need').' review',
                'Check these sales and mark them reviewed.',
            );
        }

        if ($catalog !== null) {
            $threshold = $this->percent((int) $catalog['low_margin_threshold_bps']);

            $insights[] = $this->insight(
                'products_without_cost', 'warning', 'menu.products', (int) $catalog['products_without_cost'],
                fn (int $n) => $this->count($n, 'product has', 'products have').' no cost',
                'Add a cost to each product so its margin can be tracked.',
            );
            $insights[] = $this->insight(
                'low_margin_products', 'warning', 'menu.products', (int) $catalog['low_margin_count'],
                fn (int $n) => $this->count($n, 'product is', 'products are')." below a {$threshold} margin",
                'Review the price or cost of these products to protect your profit.',
            );
            $insights[] = $this->insight(
                'products_unavailable', 'info', 'menu.products', (int) $catalog['products_unavailable'],
                fn (int $n) => $this->count($n, 'product is', 'products are').' unavailable',
                'Unavailable products cannot be sold until they are marked available again.',
            );
            $insights[] = $this->insight(
                'products_without_image', 'info', 'menu.products', (int) $catalog['products_without_image'],
                fn (int $n) => $this->count($n, 'product has', 'products have').' no photo',
                'Photos make the menu faster to scan at the counter.',
            );
            $insights[] = $this->insight(
                'categories_empty', 'info', 'menu.categories', (int) $catalog['categories_empty'],
                fn (int $n) => $this->count($n, 'category has', 'categories have').' no products',
                'Add products to empty categories or remove them to keep the menu tidy.',
            );
        }

        if ($staff !== null) {
            $insights[] = $this->insight(
                'staff_without_pin', 'warning', 'staff', (int) $staff['without_pin'],
                fn (int $n) => $this->count($n, 'active staff member has', 'active staff members have').' no PIN',
                'Set a PIN for each active staff member so they are ready for quick switching.',
            );
            $insights[] = $this->insight(
                'staff_never_logged_in', 'info', 'staff', (int) $staff['never_logged_in'],
                fn (int $n) => $this->count($n, 'active staff member has', 'active staff members have').' never logged in',
                'Check that these staff members have their login details.',
            );
        }

        $insights = array_values(array_filter($insights));

        usort($insights, fn (array $a, array $b) => [self::SEVERITY_ORDER[$a['severity']], $a['key']]
            <=> [self::SEVERITY_ORDER[$b['severity']], $b['key']]);

        return $insights;
    }

    /**
     * @param  callable(int): string  $title
     * @return array{key: string, severity: string, title: string, message: string, count: int, action: string|null}|null
     */
    private function insight(string $key, string $severity, ?string $action, int $count, callable $title, string $message): ?array
    {
        if ($count <= 0) {
            return null;
        }

        return [
            'key' => $key,
            'severity' => $severity,
            'title' => $title($count),
            'message' => $message,
            'count' => $count,
            'action' => $action,
        ];
    }

    /**
     * "1 product has" / "5 products have".
     */
    private function count(int $n, string $singular, string $plural): string
    {
        return $n.' '.($n === 1 ? $singular : $plural);
    }

    /**
     * How long ago, rounded down: "5 min ago", "2 h ago", "3 d ago" ("never" without a time).
     */
    private function ago(?CarbonInterface $at, CarbonInterface $now): string
    {
        if ($at === null) {
            return 'never';
        }

        $minutes = max(0, (int) floor($at->diffInMinutes($now, true)));

        return match (true) {
            $minutes < 60 => "{$minutes} min ago",
            $minutes < 1440 => intdiv($minutes, 60).' h ago',
            default => intdiv($minutes, 1440).' d ago',
        };
    }

    /**
     * Basis points as a percentage label: 3000 → "30%", 2550 → "25.5%".
     */
    private function percent(int $bps): string
    {
        $whole = intdiv($bps, 100);
        $fraction = rtrim(sprintf('%02d', abs($bps % 100)), '0');

        return $fraction === '' ? "{$whole}%" : "{$whole}.{$fraction}%";
    }
}
