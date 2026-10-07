<?php

use App\Http\Requests\Sync\PullCatalogueRequest;
use App\Models\Category;
use App\Models\Product;
use App\Support\SyncCursor;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->start = CarbonImmutable::parse('2026-09-24 01:00:00', 'UTC');
    $this->travelTo($this->start);

    $this->token = tokenFor(userWithRole('cashier'));
    $this->ownerToken = tokenFor(userWithRole('owner'));
});

/**
 * Travel to `$this->start` plus the given number of seconds (may be negative).
 */
function syncAt(int $seconds): void
{
    test()->travelTo(test()->start->addSeconds($seconds));
}

/**
 * GET /api/v1/sync/catalogue as the cashier.
 */
function pullCatalogue(?string $cursor = null, ?int $limit = null): TestResponse
{
    $query = http_build_query(array_filter(['cursor' => $cursor, 'limit' => $limit], fn ($value) => $value !== null));

    return test()->withToken(test()->token)->getJson('/api/v1/sync/catalogue'.($query === '' ? '' : '?'.$query));
}

/**
 * GET /api/v1/sync/catalogue as the cashier with a raw query string.
 */
function pullCatalogueRaw(string $query): TestResponse
{
    return test()->withToken(test()->token)->getJson('/api/v1/sync/catalogue?'.$query);
}

/**
 * Follow a run from the given cursor to its last page. Returns every page response.
 *
 * @return list<TestResponse>
 */
function pullRun(?string $cursor = null, ?int $limit = null): array
{
    $pages = [];

    do {
        $response = pullCatalogue($cursor, $limit)->assertOk();
        $pages[] = $response;
        $cursor = $response->json('meta.next_cursor');
    } while ($response->json('meta.has_more') && count($pages) < 50);

    return $pages;
}

/**
 * @return list<int>
 */
function syncIds(TestResponse $response, string $list): array
{
    return collect($response->json('data.'.$list))->pluck('id')->all();
}

/**
 * @return list<string>
 */
function syncCategoryKeys(): array
{
    return ['id', 'name', 'description', 'sort_order', 'is_active', 'image_url', 'image_path', 'updated_at'];
}

/**
 * @return list<string>
 */
function syncProductKeys(): array
{
    return [
        'id', 'category_id', 'sku', 'name', 'description', 'price_cents', 'is_vatable',
        'is_available', 'track_stock', 'sort_order', 'image_url', 'image_path', 'updated_at',
    ];
}

/**
 * URL-safe base64 of a raw cursor payload, for building invalid cursors.
 */
function rawSyncCursor(array $payload): string
{
    return rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
}

describe('baseline', function () {
    it('returns every non-deleted row in the exact SyncCategory / SyncProduct shape', function () {
        syncAt(-3600);
        $breakfast = Category::factory()->create([
            'name' => 'Breakfast',
            'description' => 'Served until 11 AM',
            'sort_order' => 10,
            'image_path' => 'categories/2/9f1c2a.webp',
        ]);
        $hidden = Category::factory()->inactive()->create(['name' => 'Hidden']);
        $egg = Product::factory()->forCategory($breakfast)->create([
            'sku' => 'BRK-001',
            'name' => 'Egg with Rice',
            'description' => 'Two fried eggs, garlic rice',
            'price_cents' => 5000,
            'cost_cents' => 2200,
        ]);
        $unavailable = Product::factory()->forCategory($breakfast)->unavailable()->create(['track_stock' => true]);
        $inHidden = Product::factory()->forCategory($hidden)->create();
        Product::factory()->forCategory($breakfast)->create()->delete();
        Category::factory()->create()->delete();

        syncAt(0);
        $response = $this->withToken($this->ownerToken)->getJson('/api/v1/sync/catalogue')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'meta'])
            ->and(array_keys($response->json('data')))->toBe(['categories', 'products', 'deleted'])
            ->and(array_keys($response->json('meta')))->toBe(['full', 'has_more', 'next_cursor', 'server_time'])
            ->and(syncIds($response, 'categories'))->toEqualCanonicalizing([$breakfast->id, $hidden->id])
            ->and(syncIds($response, 'products'))->toEqualCanonicalizing([$egg->id, $unavailable->id, $inHidden->id])
            ->and(array_keys($response->json('data.categories.0')))->toBe(syncCategoryKeys())
            ->and(array_keys($response->json('data.products.0')))->toBe(syncProductKeys())
            ->and($response->getContent())->not->toContain('cost_cents')
            ->and($response->getContent())->not->toContain('products_count')
            ->and($response->getContent())->not->toContain('created_at');

        $categories = collect($response->json('data.categories'))->keyBy('id');
        $products = collect($response->json('data.products'))->keyBy('id');

        expect($categories[$breakfast->id])->toBe([
            'id' => $breakfast->id,
            'name' => 'Breakfast',
            'description' => 'Served until 11 AM',
            'sort_order' => 10,
            'is_active' => true,
            'image_url' => rtrim(config('app.url'), '/').'/storage/categories/2/9f1c2a.webp',
            'image_path' => 'categories/2/9f1c2a.webp',
            'updated_at' => '2026-09-24T00:00:00Z',
        ])
            ->and($categories[$hidden->id]['is_active'])->toBeFalse()
            ->and($categories[$hidden->id]['image_url'])->toBeNull()
            ->and($products[$egg->id])->toBe([
                'id' => $egg->id,
                'category_id' => $breakfast->id,
                'sku' => 'BRK-001',
                'name' => 'Egg with Rice',
                'description' => 'Two fried eggs, garlic rice',
                'price_cents' => 5000,
                'is_vatable' => true,
                'is_available' => true,
                'track_stock' => false,
                'sort_order' => 0,
                'image_url' => null,
                'image_path' => null,
                'updated_at' => '2026-09-24T00:00:00Z',
            ])
            ->and($products[$unavailable->id]['is_available'])->toBeFalse()
            ->and($products[$unavailable->id]['track_stock'])->toBeTrue();

        $response->assertJsonPath('data.deleted', ['categories' => [], 'products' => []])
            ->assertJsonPath('meta.full', true)
            ->assertJsonPath('meta.has_more', false)
            ->assertJsonPath('meta.server_time', '2026-09-24T01:00:00Z');

        expect($response->json('meta.next_cursor'))->toBeString()->not->toBe('');
    });

    it('returns empty lists and a cursor for an empty catalogue', function () {
        pullCatalogue()
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'categories' => [],
                    'products' => [],
                    'deleted' => ['categories' => [], 'products' => []],
                ],
                'meta' => [
                    'full' => true,
                    'has_more' => false,
                    'next_cursor' => SyncCursor::nextRun(null)->encode(),
                    'server_time' => '2026-09-24T01:00:00Z',
                ],
            ]);
    });
});

describe('delta', function () {
    beforeEach(function () {
        // An old menu, and one row changed at the baseline's boundary.
        syncAt(-86000);
        $this->breakfast = Category::factory()->create(['name' => 'Breakfast']);
        $this->drinks = Category::factory()->create(['name' => 'Drinks']);
        $this->egg = Product::factory()->forCategory($this->breakfast)->create(['price_cents' => 5000]);
        $this->tea = Product::factory()->forCategory($this->drinks)->create();

        syncAt(-60);
        $this->water = Product::factory()->forCategory($this->drinks)->create();

        syncAt(0);
        $this->cursor = pullCatalogue()->assertOk()->json('meta.next_cursor');
    });

    it('returns only rows changed since the cursor (plus the overlap), with full false', function () {
        syncAt(60);
        $this->withToken($this->ownerToken)
            ->patchJson('/api/v1/admin/products/'.$this->egg->id, ['price_cents' => 5500])
            ->assertOk();

        syncAt(120);
        $response = pullCatalogue($this->cursor)->assertOk();

        // water is the baseline's newest row (updated at -60): re-sent on purpose by the overlap.
        expect(syncIds($response, 'products'))->toBe([$this->water->id, $this->egg->id])
            ->and(syncIds($response, 'categories'))->toBe([])
            ->and($response->json('data.products.1.price_cents'))->toBe(5500)
            ->and($response->json('data.products.1.updated_at'))->toBe('2026-09-24T01:01:00Z')
            ->and($response->getContent())->not->toContain('cost_cents');

        $response->assertJsonPath('data.deleted', ['categories' => [], 'products' => []])
            ->assertJsonPath('meta.full', false)
            ->assertJsonPath('meta.has_more', false)
            ->assertJsonPath('meta.server_time', '2026-09-24T01:02:00Z');
    });

    it('sends soft-deleted rows as tombstones, ids sorted ascending', function () {
        $empty = Category::factory()->create(['name' => 'Empty']);
        $cursor = pullCatalogue($this->cursor)->assertOk()->json('meta.next_cursor');

        // Delete in descending id order, so the updated_at order differs from the id order.
        syncAt(30);
        $this->withToken($this->ownerToken)->deleteJson('/api/v1/admin/products/'.$this->tea->id)->assertNoContent();
        syncAt(40);
        $this->withToken($this->ownerToken)->deleteJson('/api/v1/admin/products/'.$this->egg->id)->assertNoContent();
        syncAt(50);
        $this->withToken($this->ownerToken)->deleteJson('/api/v1/admin/categories/'.$empty->id)->assertNoContent();

        syncAt(60);
        $response = pullCatalogue($cursor)->assertOk();

        expect($this->egg->id)->toBeLessThan($this->tea->id)
            ->and($response->json('data.deleted.products'))->toBe([$this->egg->id, $this->tea->id])
            ->and($response->json('data.deleted.categories'))->toBe([$empty->id])
            ->and(syncIds($response, 'products'))->not->toContain($this->egg->id)
            ->and(syncIds($response, 'products'))->not->toContain($this->tea->id)
            ->and(syncIds($response, 'categories'))->not->toContain($empty->id);

        // A new baseline no longer has the deleted rows, and never sends tombstones.
        $baseline = pullCatalogue()->assertOk();
        expect(syncIds($baseline, 'products'))->toEqualCanonicalizing([$this->water->id])
            ->and($baseline->json('data.deleted'))->toBe(['categories' => [], 'products' => []]);
    });

    it('includes an image upload and an image removal in the delta', function () {
        $disk = fakeCatalogImageDisk();

        syncAt(30);
        $path = $this->withToken($this->ownerToken)
            ->post('/api/v1/admin/products/'.$this->tea->id.'/image', ['image' => fakeWebp('tea.webp', 400, 400)], ['Accept' => 'application/json'])
            ->assertOk()
            ->json('data.image_path');
        $disk->assertExists($path);

        syncAt(40);
        $response = pullCatalogue($this->cursor)->assertOk();
        $tea = collect($response->json('data.products'))->firstWhere('id', $this->tea->id);

        expect($tea['image_path'])->toBe($path)
            ->and($tea['image_url'])->toBe(rtrim(config('app.url'), '/').'/storage/'.$path)
            ->and($tea['updated_at'])->toBe('2026-09-24T01:00:30Z');

        $cursor = $response->json('meta.next_cursor');

        syncAt(70);
        $this->withToken($this->ownerToken)
            ->deleteJson('/api/v1/admin/products/'.$this->tea->id.'/image')
            ->assertOk();

        syncAt(80);
        $response = pullCatalogue($cursor)->assertOk();
        $tea = collect($response->json('data.products'))->firstWhere('id', $this->tea->id);

        expect($tea['image_path'])->toBeNull()
            ->and($tea['image_url'])->toBeNull()
            ->and($tea['updated_at'])->toBe('2026-09-24T01:01:10Z');
    });

    it('sends a row that changes during a paged delta run on a later page of that run', function () {
        syncAt(10);
        $tea2 = Product::factory()->forCategory($this->drinks)->create();
        $tea3 = Product::factory()->forCategory($this->drinks)->create();

        syncAt(20);
        $first = pullCatalogue($this->cursor, limit: 1)->assertOk();
        expect(syncIds($first, 'products'))->toBe([$this->water->id])
            ->and($first->json('meta.has_more'))->toBeTrue();

        syncAt(25);
        $this->egg->update(['name' => 'Changed mid-run']);

        $pages = [$first, ...pullRun($first->json('meta.next_cursor'), limit: 1)];
        $sent = collect($pages)->flatMap(fn (TestResponse $page) => syncIds($page, 'products'))->all();

        expect($sent)->toBe([$this->water->id, $tea2->id, $tea3->id, $this->egg->id])
            ->and(collect($pages)->every(fn (TestResponse $page) => $page->json('meta.full') === false))->toBeTrue()
            ->and(end($pages)->json('meta.has_more'))->toBeFalse();
    });
});

describe('restart point', function () {
    it('re-sends the boundary rows (5-second overlap) and does not drift when nothing changed', function () {
        syncAt(-3600);
        $old = Category::factory()->create();
        syncAt(-8);
        $boundaryCategory = Category::factory()->create();
        syncAt(-4);
        $boundaryProduct = Product::factory()->forCategory($old)->create();

        syncAt(0);
        $baselineCursor = pullCatalogue()->assertOk()->json('meta.next_cursor');

        // Newest seen = -4, so the next delta starts at -9: both boundary rows are re-sent.
        syncAt(60);
        $delta1 = pullCatalogue($baselineCursor)->assertOk();
        expect(syncIds($delta1, 'categories'))->toBe([$boundaryCategory->id])
            ->and(syncIds($delta1, 'products'))->toBe([$boundaryProduct->id])
            ->and($delta1->json('meta.next_cursor'))->toBe($baselineCursor)
            ->and($delta1->json('meta.next_cursor'))->toBe(SyncCursor::nextRun($this->start->getTimestamp() - 9)->encode());

        // Again, much later: same rows, same cursor. The restart point never moves backwards.
        syncAt(3600);
        $delta2 = pullCatalogue($delta1->json('meta.next_cursor'))->assertOk();
        expect(syncIds($delta2, 'categories'))->toBe([$boundaryCategory->id])
            ->and(syncIds($delta2, 'products'))->toBe([$boundaryProduct->id])
            ->and($delta2->json('meta.next_cursor'))->toBe($baselineCursor);
    });

    it('keeps the previous restart point when a run sees no rows', function () {
        $cursor = pullCatalogue()->assertOk()->json('meta.next_cursor');

        syncAt(600);
        $delta = pullCatalogue($cursor)->assertOk();

        expect($delta->json('data.categories'))->toBe([])
            ->and($delta->json('data.products'))->toBe([])
            ->and($delta->json('meta.next_cursor'))->toBe($cursor);

        // A row created later is picked up by the unchanged cursor.
        syncAt(700);
        $category = Category::factory()->create();

        syncAt(800);
        expect(syncIds(pullCatalogue($cursor)->assertOk(), 'categories'))->toBe([$category->id]);
    });

    it('caps the restart point at the server time when a row is dated in the future', function () {
        syncAt(3600);
        $future = Category::factory()->create();

        syncAt(0);
        $response = pullCatalogue()->assertOk();

        expect(syncIds($response, 'categories'))->toBe([$future->id])
            ->and($response->json('meta.next_cursor'))->toBe(SyncCursor::nextRun($this->start->getTimestamp() - 5)->encode());

        // The next delta still sends the future-dated row.
        syncAt(10);
        expect(syncIds(pullCatalogue($response->json('meta.next_cursor'))->assertOk(), 'categories'))->toBe([$future->id]);
    });

    it('does not miss a row deleted during a paged baseline', function () {
        syncAt(-300);
        $category = Category::factory()->create();
        syncAt(-200);
        $first = Product::factory()->forCategory($category)->create();
        syncAt(-100);
        $second = Product::factory()->forCategory($category)->create();

        syncAt(0);
        $page1 = pullCatalogue(limit: 1)->assertOk();
        expect(syncIds($page1, 'products'))->toBe([$first->id])
            ->and($page1->json('meta.has_more'))->toBeTrue();

        // While the baseline is still running: the sent product is deleted, another row changes.
        syncAt(2);
        $first->delete();
        syncAt(10);
        $second->update(['name' => 'Renamed']);

        $rest = pullRun($page1->json('meta.next_cursor'), limit: 1);
        expect(collect($rest)->every(fn (TestResponse $page) => $page->json('meta.full') === true))->toBeTrue();

        syncAt(20);
        $delta = pullCatalogue(end($rest)->json('meta.next_cursor'))->assertOk();

        expect($delta->json('data.deleted.products'))->toBe([$first->id]);
    });
});

describe('paging', function () {
    it('pages each entity independently on (updated_at, id) with no row lost or duplicated', function () {
        // 5 categories and 3 products; several share a timestamp, so the id breaks the tie.
        syncAt(-50);
        $c1 = Category::factory()->create();
        $c2 = Category::factory()->create();
        syncAt(-40);
        $c3 = Category::factory()->create();
        $p1 = Product::factory()->forCategory($c1)->create();
        $p2 = Product::factory()->forCategory($c1)->create();
        syncAt(-30);
        $c4 = Category::factory()->create();
        $c5 = Category::factory()->create();
        $p3 = Product::factory()->forCategory($c2)->create();

        syncAt(0);
        $pages = pullRun(limit: 2);

        expect($pages)->toHaveCount(3)
            ->and(array_map(fn (TestResponse $page) => count($page->json('data.categories')), $pages))->toBe([2, 2, 1])
            ->and(array_map(fn (TestResponse $page) => count($page->json('data.products')), $pages))->toBe([2, 1, 0])
            ->and(array_map(fn (TestResponse $page) => $page->json('meta.has_more'), $pages))->toBe([true, true, false])
            ->and(array_map(fn (TestResponse $page) => $page->json('meta.full'), $pages))->toBe([true, true, true]);

        $categoryIds = collect($pages)->flatMap(fn (TestResponse $page) => syncIds($page, 'categories'))->all();
        $productIds = collect($pages)->flatMap(fn (TestResponse $page) => syncIds($page, 'products'))->all();

        expect($categoryIds)->toBe([$c1->id, $c2->id, $c3->id, $c4->id, $c5->id])
            ->and($productIds)->toBe([$p1->id, $p2->id, $p3->id]);

        // Every page carries a cursor, and the last one starts the next run.
        expect(collect($pages)->every(fn (TestResponse $page) => is_string($page->json('meta.next_cursor'))))->toBeTrue()
            ->and(SyncCursor::decode($pages[2]->json('meta.next_cursor'))->startsRun())->toBeTrue()
            ->and(SyncCursor::decode($pages[0]->json('meta.next_cursor'))->startsRun())->toBeFalse();
    });

    it('counts changed and deleted rows together towards the per-entity limit in a delta', function () {
        syncAt(-3600);
        $category = Category::factory()->create();
        $products = Product::factory()->forCategory($category)->count(5)->create();

        syncAt(0);
        $cursor = pullCatalogue()->assertOk()->json('meta.next_cursor');

        syncAt(10);
        $products[0]->delete();
        $products[1]->update(['price_cents' => 1234]);
        $products[2]->delete();
        $products[3]->update(['price_cents' => 4321]);
        $products[4]->delete();

        syncAt(20);
        $pages = pullRun($cursor, limit: 2);

        expect($pages)->toHaveCount(3)
            ->and(array_map(
                fn (TestResponse $page) => count($page->json('data.products')) + count($page->json('data.deleted.products')),
                $pages,
            ))->toBe([2, 2, 1]);

        $changed = collect($pages)->flatMap(fn (TestResponse $page) => syncIds($page, 'products'))->all();
        $deleted = collect($pages)->flatMap(fn (TestResponse $page) => $page->json('data.deleted.products'))->all();

        expect($changed)->toBe([$products[1]->id, $products[3]->id])
            ->and($deleted)->toBe([$products[0]->id, $products[2]->id, $products[4]->id]);
    });

    it('uses a default limit of 500 per entity', function () {
        $category = Category::factory()->create();
        Product::factory()->forCategory($category)->count(501)->create();

        $page1 = pullCatalogue()->assertOk();
        expect($page1->json('data.products'))->toHaveCount(500)
            ->and($page1->json('meta.has_more'))->toBeTrue();

        $page2 = pullCatalogue($page1->json('meta.next_cursor'))->assertOk();
        expect($page2->json('data.products'))->toHaveCount(1)
            ->and($page2->json('data.categories'))->toBe([])
            ->and($page2->json('meta.has_more'))->toBeFalse()
            ->and($page2->json('meta.full'))->toBeTrue();
    });
});

describe('errors', function () {
    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/sync/catalogue')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns JSON 401 even without an Accept header', function () {
        $this->get('/api/v1/sync/catalogue')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('validates limit', function (string $query, string $message) {
        pullCatalogueRaw($query)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['limit' => $message]);
    })->with([
        ['limit=0', 'The limit field must be at least 1.'],
        ['limit=501', 'The limit field must not be greater than 500.'],
        ['limit=abc', 'The limit field must be an integer.'],
    ]);

    it('rejects an invalid cursor with the exact message', function (string $cursor) {
        pullCatalogueRaw('cursor='.urlencode($cursor))
            ->assertUnprocessable()
            ->assertExactJson([
                'message' => PullCatalogueRequest::INVALID_CURSOR,
                'errors' => ['cursor' => [PullCatalogueRequest::INVALID_CURSOR]],
            ]);

        expect(PullCatalogueRequest::INVALID_CURSOR)->toBe('The sync cursor is invalid. Start a full sync.');
    })->with([
        'not base64' => [fn () => 'not a cursor!'],
        'base64 of garbage' => [fn () => rtrim(strtr(base64_encode('garbage'), '+/', '-_'), '=')],
        'a JSON list' => [fn () => rawSyncCursor([1, 2, 3])],
        'unknown version' => [fn () => rawSyncCursor(['v' => 2, 'f' => false, 'r' => 0, 't' => null, 'n' => null, 'c' => null, 'p' => null])],
        'no version' => [fn () => rawSyncCursor(['f' => false, 'r' => 0])],
        'a bad position' => [fn () => rawSyncCursor(['v' => 1, 'f' => false, 'r' => 0, 't' => 0, 'n' => null, 'c' => ['x', 1], 'p' => null])],
        'a restart point in the future' => [fn () => SyncCursor::nextRun(test()->start->getTimestamp() + 60)->encode()],
        'a run started in the future' => [fn () => SyncCursor::continueRun(true, null, test()->start->getTimestamp() + 60, null, null, null)->encode()],
    ]);

    it('rejects a cursor longer than 1000 characters', function () {
        pullCatalogueRaw('cursor='.str_repeat('a', 1001))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['cursor' => 'The cursor field must not be greater than 1000 characters.']);
    });
});
