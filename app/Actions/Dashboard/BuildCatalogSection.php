<?php

namespace App\Actions\Dashboard;

use App\Models\Category;
use App\Models\Product;
use App\Support\Margin;

/**
 * The dashboard `catalog` section (global; soft-deleted rows excluded).
 *
 * Three aggregate queries, whatever the size of the menu:
 * 1. product totals and margin sums (one row),
 * 2. the up-to-5 lowest-margin products,
 * 3. one row per category, joined to per-category product aggregates.
 *
 * Margins follow App\Support\Margin (basis points, toward zero, price or cost 0 excluded).
 * Besides the contract fields, the result carries `low_margin_count` (the uncapped count,
 * for the insight); BuildDashboardAction removes it before the section is returned.
 */
class BuildCatalogSection
{
    public const LOW_MARGIN_LIMIT = 5;

    /**
     * @return array<string, mixed>
     */
    public function execute(): array
    {
        $threshold = (int) config('pos.low_margin_threshold_bps', 3000);
        $qualifies = Margin::qualifiesSql();
        $margin = Margin::bpsSql();

        $totals = Product::query()
            ->toBase()
            ->selectRaw('COUNT(*) AS total')
            ->selectRaw('SUM(products.is_available = 1) AS available')
            ->selectRaw('SUM(products.image_path IS NULL) AS without_image')
            ->selectRaw('SUM(products.track_stock = 1) AS tracking_stock')
            ->selectRaw('SUM(products.cost_cents = 0) AS without_cost')
            ->selectRaw("SUM({$qualifies}) AS margin_count")
            ->selectRaw("SUM(CASE WHEN {$qualifies} THEN {$margin} END) AS margin_sum")
            ->selectRaw("SUM({$qualifies} AND {$margin} < ?) AS low_margin_count", [$threshold])
            ->first();

        $total = (int) $totals->total;
        $available = (int) $totals->available;

        $lowMargin = Product::query()
            ->toBase()
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->whereRaw($qualifies)
            ->whereRaw("{$margin} < ?", [$threshold])
            ->select(['products.id', 'products.name', 'categories.name AS category_name', 'products.price_cents', 'products.cost_cents'])
            ->selectRaw("{$margin} AS margin_bps")
            ->orderBy('margin_bps')
            ->orderBy('products.name')
            ->orderBy('products.id')
            ->limit(self::LOW_MARGIN_LIMIT)
            ->get()
            ->map(fn (object $row) => [
                'id' => (int) $row->id,
                'name' => $row->name,
                'category_name' => $row->category_name,
                'price_cents' => (int) $row->price_cents,
                'cost_cents' => (int) $row->cost_cents,
                'margin_bps' => (int) $row->margin_bps,
            ])
            ->all();

        $perCategory = Product::query()
            ->toBase()
            ->select('products.category_id')
            ->selectRaw('COUNT(*) AS products_total')
            ->selectRaw('SUM(products.is_available = 1) AS products_available')
            ->selectRaw("SUM({$qualifies}) AS margin_count")
            ->selectRaw("SUM(CASE WHEN {$qualifies} THEN {$margin} END) AS margin_sum")
            ->groupBy('products.category_id');

        $categories = Category::query()
            ->toBase()
            ->leftJoinSub($perCategory, 'p', 'p.category_id', '=', 'categories.id')
            ->select(['categories.id', 'categories.name', 'categories.is_active'])
            ->selectRaw('COALESCE(p.products_total, 0) AS products_total')
            ->selectRaw('COALESCE(p.products_available, 0) AS products_available')
            ->selectRaw('COALESCE(p.margin_count, 0) AS margin_count')
            ->selectRaw('COALESCE(p.margin_sum, 0) AS margin_sum')
            ->orderBy('categories.sort_order')
            ->orderBy('categories.name')
            ->orderBy('categories.id')
            ->get();

        $byCategory = $categories
            ->map(fn (object $row) => [
                'category_id' => (int) $row->id,
                'name' => $row->name,
                'is_active' => (bool) $row->is_active,
                'products_total' => (int) $row->products_total,
                'products_available' => (int) $row->products_available,
                'average_margin_bps' => Margin::average((int) $row->margin_sum, (int) $row->margin_count),
            ])
            ->all();

        return [
            'products_total' => $total,
            'products_available' => $available,
            'products_unavailable' => $total - $available,
            'products_without_image' => (int) $totals->without_image,
            'products_tracking_stock' => (int) $totals->tracking_stock,
            'products_without_cost' => (int) $totals->without_cost,
            'categories_total' => count($byCategory),
            'categories_active' => count(array_filter($byCategory, fn (array $c) => $c['is_active'])),
            'categories_empty' => count(array_filter($byCategory, fn (array $c) => $c['products_total'] === 0)),
            'average_margin_bps' => Margin::average((int) $totals->margin_sum, (int) $totals->margin_count),
            'low_margin_threshold_bps' => $threshold,
            'low_margin_products' => $lowMargin,
            'by_category' => $byCategory,
            'low_margin_count' => (int) $totals->low_margin_count,
        ];
    }
}
