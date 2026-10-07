<?php

namespace App\Actions\Sync;

use App\Models\Category;
use App\Models\Product;
use App\Support\SyncCursor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;

/**
 * Builds one page of GET /api/v1/sync/catalogue (Phase 2).
 *
 * - **Baseline** (no cursor, or a cursor continuing a baseline run): every non-deleted
 *   category and product, including inactive and unavailable ones; `deleted` is empty.
 * - **Delta** (a cursor): every row, soft-deleted ones included, with `updated_at` at or
 *   after the run's restart point. Soft-deleted rows become tombstones (ids only).
 * - **Paging:** each entity is keyset-paged on `(updated_at, id)` ascending, up to
 *   `limit` rows per entity per page, independently of the other entity.
 * - **Restart point** (on the last page of a run): `min(newest updated_at seen in the
 *   run, run start) − 5 seconds`, never before the run's own restart point. A run that
 *   saw no rows keeps its restart point unchanged.
 *
 * The catalogue is global master data, so the result does not depend on the caller.
 */
class PullCatalogueAction
{
    /**
     * Seconds of overlap between runs. Covers second-precision timestamps and writes
     * that commit while a sync is running; the device upserts, so repeats are harmless.
     */
    public const OVERLAP_SECONDS = 5;

    /**
     * @return array{
     *     categories: Collection<int, Category>,
     *     products: Collection<int, Product>,
     *     deleted: array{categories: list<int>, products: list<int>},
     *     full: bool,
     *     has_more: bool,
     *     next_cursor: string,
     *     server_time: CarbonImmutable,
     * }
     */
    public function execute(?SyncCursor $cursor, int $limit, ?CarbonImmutable $now = null): array
    {
        $now = ($now ?? now()->toImmutable())->utc();

        $full = $cursor === null || $cursor->full;
        $since = $cursor?->since;
        $runStartedAt = $cursor?->runStartedAt ?? $now->getTimestamp();

        [$categories, $moreCategories] = $this->page(Category::query(), $full, $since, $cursor?->categories, $limit);
        [$products, $moreProducts] = $this->page(Product::query(), $full, $since, $cursor?->products, $limit);

        $newest = $this->newest($cursor?->newest, $categories, $products);
        $hasMore = $moreCategories || $moreProducts;

        $nextCursor = $hasMore
            ? SyncCursor::continueRun(
                full: $full,
                since: $since,
                runStartedAt: $runStartedAt,
                newest: $newest,
                categories: $this->position($categories) ?? $cursor?->categories,
                products: $this->position($products) ?? $cursor?->products,
            )
            : SyncCursor::nextRun($this->restartPoint($since, $newest, $runStartedAt));

        [$deletedCategories, $categories] = $categories->partition(fn (Model $row) => $row->trashed());
        [$deletedProducts, $products] = $products->partition(fn (Model $row) => $row->trashed());

        return [
            'categories' => $categories->values(),
            'products' => $products->values(),
            'deleted' => [
                'categories' => $this->sortedIds($deletedCategories),
                'products' => $this->sortedIds($deletedProducts),
            ],
            'full' => $full,
            'has_more' => $hasMore,
            'next_cursor' => $nextCursor->encode(),
            'server_time' => $now,
        ];
    }

    /**
     * One keyset page of an entity, plus whether rows are left after it.
     *
     * @template TModel of Category|Product
     *
     * @param  Builder<TModel>  $query
     * @param  array{0: int, 1: int}|null  $after  the last `[updated_at, id]` sent in this run
     * @return array{0: Collection<int, TModel>, 1: bool}
     */
    private function page(Builder $query, bool $full, ?int $since, ?array $after, int $limit): array
    {
        $model = $query->getModel();

        // Tombstones are soft-deleted rows; a baseline never sends them.
        if (! $full) {
            $query->withTrashed();
        }

        $rows = $query
            ->when($since !== null, fn (Builder $q) => $q->where('updated_at', '>=', $this->at($model, $since)))
            ->when($after !== null, function (Builder $q) use ($model, $after) {
                $at = $this->at($model, $after[0]);

                $q->where(fn (Builder $q) => $q
                    ->where('updated_at', '>', $at)
                    ->orWhere(fn (Builder $q) => $q->where('updated_at', '=', $at)->where('id', '>', $after[1])));
            })
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;

        return [$hasMore ? $rows->take($limit)->values() : $rows, $hasMore];
    }

    /**
     * A unix timestamp in the format the model stores `updated_at` in.
     */
    private function at(Model $model, int $timestamp): string
    {
        return $model->fromDateTime(CarbonImmutable::createFromTimestamp($timestamp, config('app.timezone')));
    }

    /**
     * The `[updated_at, id]` of the last row of a page, or null when the page is empty.
     *
     * @param  Collection<int, covariant Model>  $rows
     * @return array{0: int, 1: int}|null
     */
    private function position(Collection $rows): ?array
    {
        $last = $rows->last();

        return $last === null ? null : [$last->updated_at->getTimestamp(), (int) $last->getKey()];
    }

    /**
     * The newest `updated_at` seen in the run so far, including this page.
     *
     * @param  Collection<int, Category>  $categories
     * @param  Collection<int, Product>  $products
     */
    private function newest(?int $previous, Collection $categories, Collection $products): ?int
    {
        $timestamps = array_filter([
            $previous,
            $this->position($categories)[0] ?? null,
            $this->position($products)[0] ?? null,
        ], fn (?int $timestamp) => $timestamp !== null);

        return $timestamps === [] ? null : max($timestamps);
    }

    /**
     * Where the next run starts. A run that saw no rows keeps its restart point, and the
     * restart point never moves backwards.
     */
    private function restartPoint(?int $since, ?int $newest, int $runStartedAt): ?int
    {
        if ($newest === null) {
            return $since;
        }

        $restart = max(0, min($newest, $runStartedAt) - self::OVERLAP_SECONDS);

        return $since === null ? $restart : max($since, $restart);
    }

    /**
     * @param  Collection<int, covariant Model>  $rows
     * @return list<int>
     */
    private function sortedIds(Collection $rows): array
    {
        return $rows->map(fn (Model $row) => (int) $row->getKey())->sort()->values()->all();
    }
}
