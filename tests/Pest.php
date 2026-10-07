<?php

use App\Actions\Inventory\RecordStockMovementAction;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Ingredient;
use App\Models\Permission;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\User;
use App\Support\Quantity;
use Brick\Math\BigDecimal;
use Carbon\CarbonImmutable;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Pest\TestSuite;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Feature tests run against the isolated pos_mobile_test database (forced in
| phpunit.xml) and are wrapped in RefreshDatabase.
|
*/

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

// The report benchmark (group `performance`, excluded from the default run) commits its
// seeded year of sales, so the optimizer has real statistics, as in production. It still
// runs only against pos_mobile_test, migrated fresh before and rolled back after.
pest()->extend(TestCase::class)
    ->use(DatabaseMigrations::class)
    ->in('Performance');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
*/

/**
 * Seed the contract's roles and permissions (the same in every environment).
 */
function seedRoles(): void
{
    test()->seed(RolesAndPermissionsSeeder::class);
}

/**
 * The contract's dev branch (MAIN).
 */
function mainBranch(): Branch
{
    return Branch::factory()->create([
        'code' => 'MAIN',
        'name' => 'Main Branch',
        'timezone' => 'Asia/Manila',
        'day_start_time' => '04:00:00',
    ]);
}

/**
 * Issue a `mobile-app` API token for the user, as login does.
 */
function tokenFor(User $user): string
{
    return $user->createApiToken(now()->addHours(24))->plainTextToken;
}

/**
 * A user in a fresh MAIN-style branch with the given seeded role (owner, manager, cashier).
 * Call seedRoles() first.
 */
function userWithRole(string $slug, array $attributes = []): User
{
    $branch = Branch::query()->first() ?? mainBranch();

    return User::factory()->forBranch($branch)->withRole($slug)->create($attributes);
}

/**
 * Replace the catalogue image disk with a fake that still produces absolute
 * URLs from APP_URL, like the real `public` disk.
 */
function fakeCatalogImageDisk(): FilesystemAdapter
{
    return Storage::fake(
        (string) config('pos.catalog_image_disk'),
        ['url' => rtrim((string) config('app.url'), '/').'/storage'],
    );
}

/**
 * A minimal but valid lossless WebP file of the given size. GD on this machine
 * cannot encode WebP, so the header is written by hand (getimagesize() reads it).
 */
function fakeWebp(string $name, int $width, int $height): UploadedFile
{
    $payload = "\x2f".pack('V', ($width - 1) | (($height - 1) << 14)).str_repeat("\0", 16);
    $chunk = 'VP8L'.pack('V', strlen($payload)).$payload;

    return UploadedFile::fake()->createWithContent($name, 'RIFF'.pack('V', 4 + strlen($chunk)).'WEBP'.$chunk);
}

/**
 * A minimal JPEG (SOI, JFIF, SOF0 with the given size, EOI). GD on this machine
 * has no JPEG support, so UploadedFile::fake()->image('x.jpg') cannot be used.
 */
function fakeJpeg(string $name, int $width, int $height): UploadedFile
{
    $bytes = "\xFF\xD8"
        ."\xFF\xE0".pack('n', 16)."JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        ."\xFF\xC0".pack('n', 17)."\x08".pack('n', $height).pack('n', $width)
        ."\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01"
        ."\xFF\xD9";

    return UploadedFile::fake()->createWithContent($name, $bytes);
}

/**
 * The most recent audit log entry with the given action.
 */
function lastAudit(string $action): ?AuditLog
{
    return AuditLog::query()->where('action', $action)->latest('id')->first();
}

/**
 * The contract's `Category` keys, in order.
 *
 * @return list<string>
 */
function categoryKeys(): array
{
    return [
        'id', 'name', 'description', 'sort_order', 'is_active', 'products_count',
        'image_url', 'image_path', 'created_at', 'updated_at',
    ];
}

/**
 * The contract's `Product` keys, in order. `cost_cents` and (Phase 3) `stock_qty` only on
 * admin endpoints (`$withCost`).
 *
 * @return list<string>
 */
function productKeys(bool $withCost): array
{
    return array_values(array_filter([
        'id', 'category', 'sku', 'name', 'description', 'price_cents',
        $withCost ? 'cost_cents' : null,
        'is_vatable', 'is_available', 'track_stock', 'stock_mode',
        $withCost ? 'stock_qty' : null,
        'sort_order', 'image_url', 'image_path', 'created_at', 'updated_at',
    ]));
}

/**
 * The contract's `StaffUser` keys, in order.
 *
 * @return list<string>
 */
function staffUserKeys(): array
{
    return [
        'id', 'name', 'email', 'is_active', 'has_pin', 'can_manage', 'last_login_at',
        'role', 'created_at', 'updated_at',
    ];
}

/**
 * The contract's `Customer` keys, in order.
 *
 * @return list<string>
 */
function customerKeys(): array
{
    return [
        'id', 'first_name', 'last_name', 'full_name', 'contact', 'email', 'notes',
        'created_at', 'updated_at',
    ];
}

/**
 * A password that satisfies the staff password policy.
 */
const STRONG_PASSWORD = 'Str0ngPassw0rd';

/*
|--------------------------------------------------------------------------
| Phase 3: sales, stock and PINs
|--------------------------------------------------------------------------
*/

/**
 * A new client ULID (uppercase Crockford base32), as the app generates.
 */
function newUlid(): string
{
    return (string) Str::ulid();
}

/**
 * The `shift_ulid` the sale helpers send (Phase 6): one ULID per test, for a shift the server
 * doesn't know (so sales are accepted, as before shifts existed). Pass another value to
 * target a real shift.
 */
function testShiftUlid(): string
{
    static $ulids;
    $ulids ??= new WeakMap;

    // The running test case itself (test() returns a proxy without __isset).
    $test = TestSuite::getInstance()->test;

    return $ulids[$test] ??= newUlid();
}

/**
 * Give a product stock in a branch (default: the product's first branch, MAIN), the way
 * any stock change is written: an `opening` movement plus the level, in one transaction.
 */
function stockUp(Product $product, int $qty, ?Branch $branch = null): void
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();

    DB::transaction(fn () => app(RecordStockMovementAction::class)->execute(
        level: StockLevel::lockOrCreate($branch->id, $product->id),
        type: StockMovement::TYPE_OPENING,
        qtyDelta: $qty,
        unitCostCents: $product->cost_cents,
        actor: null,
        occurredAt: now(),
        reason: 'Opening stock',
    ));
}

/**
 * Inventory (v1 completion): write one movement of any type at the given time (default now),
 * the way every stock change is written (the movement plus the level, in one transaction).
 */
function recordMovement(Product $product, string $type, int $qty, ?string $occurredAt = null, ?Branch $branch = null, ?User $actor = null, ?string $reason = null): StockMovement
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();

    return DB::transaction(fn () => app(RecordStockMovementAction::class)->execute(
        level: StockLevel::lockOrCreate($branch->id, $product->id),
        type: $type,
        qtyDelta: $qty,
        unitCostCents: $product->cost_cents,
        actor: $actor,
        occurredAt: $occurredAt === null ? now() : CarbonImmutable::parse($occurredAt, 'UTC'),
        reason: $reason,
    ));
}

/**
 * Inventory (v1 completion): set a product's reorder level in a branch directly (the level row
 * is created at 0 when missing).
 */
function setReorderLevel(Product $product, ?int $level, ?Branch $branch = null): void
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();

    DB::transaction(fn () => StockLevel::lockOrCreate($branch->id, $product->id)->forceFill(['reorder_level' => $level])->save());
}

/**
 * The contract's `InventoryItem` keys, in order.
 *
 * @return list<string>
 */
function inventoryItemKeys(): array
{
    return [
        'product_id', 'name', 'sku', 'category', 'image_url', 'is_available', 'qty', 'reorder_level', 'status',
        'cost_cents', 'stock_value_cents', 'last_movement_at',
    ];
}

/**
 * The branch's quantity on hand of a product (a missing level is 0).
 */
function stockOf(Product $product, ?Branch $branch = null): int
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();

    return (int) StockLevel::query()
        ->where('branch_id', $branch->id)
        ->where('product_id', $product->id)
        ->value('qty');
}

/**
 * A role granting exactly the given permission slugs (call seedRoles() first).
 *
 * @param  list<string>  $permissions
 */
function customRole(string $slug, array $permissions, int $maxDiscountPercent = 0): Role
{
    $role = Role::factory()->create([
        'slug' => $slug,
        'name' => Str::headline($slug),
        'max_discount_percent' => $maxDiscountPercent,
    ]);
    $role->permissions()->sync(Permission::query()->whereIn('slug', $permissions)->pluck('id'));

    return $role;
}

/**
 * Give a user a PIN (hashed, as the staff endpoints store it).
 */
function withPin(User $user, string $pin): User
{
    $user->forceFill(['pin_hash' => Hash::make($pin)])->save();

    return $user;
}

/**
 * POST /api/v1/orders as the user, with `Idempotency-Key` = the body's `ulid` unless given.
 */
function postOrder(User $user, array $payload, ?string $key = null): TestResponse
{
    $headers = ['Idempotency-Key' => $key ?? ($payload['ulid'] ?? '')];

    return test()->withToken(tokenFor($user))->postJson('/api/v1/orders', $payload, $headers);
}

/**
 * A simple valid sale body: whole-price lines without discounts, paid exactly in cash.
 * `$lines` maps each product to its qty (a list of [Product, qty] pairs).
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 */
function simpleSale(array $lines, array $overrides = []): array
{
    $total = array_sum(array_map(fn (array $line) => $line[0]->price_cents * $line[1], $lines));

    return array_replace([
        'ulid' => newUlid(),
        'shift_ulid' => testShiftUlid(),
        'customer_id' => null,
        'notes' => null,
        'items' => array_map(fn (array $line) => [
            'product_id' => $line[0]->id, 'qty' => $line[1], 'discount' => null, 'notes' => null,
        ], $lines),
        'discount' => null,
        'payments' => $total > 0 ? [['method' => 'cash', 'amount_cents' => $total, 'reference_no' => null]] : [],
        'client_total_cents' => $total,
        'discount_authorization' => null,
    ], $overrides);
}

/**
 * Complete a simple sale through the API and return its `Order` JSON.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @return array<string, mixed>
 */
function sell(User $user, array $lines, array $overrides = []): array
{
    return postOrder($user, simpleSale($lines, $overrides))->assertCreated()->json('data');
}

/**
 * The contract's `Order` keys, in order (`table_no` since Core Sale revision 2; `order_no`
 * and the offline fields since Phase 5; `shift_ulid` since Phase 6; the void fields,
 * `refunded_cents` and `refunds` since Phase 7).
 *
 * @return list<string>
 */
function orderKeys(): array
{
    return [
        'ulid', 'invoice_no', 'order_no', 'queue_no', 'table_no', 'business_date', 'status', 'placed_at',
        'cashier', 'authorized_by', 'customer', 'notes', 'subtotal_cents', 'line_discounts_cents',
        'order_discount', 'sc_pwd', 'discount_cents', 'total_cents', 'vatable_sales_cents',
        'vat_amount_cents', 'vat_exempt_sales_cents', 'tendered_cents', 'change_cents',
        'client_total_cents', 'has_total_mismatch',
        'source', 'needs_review', 'review_reasons', 'reviewed_at', 'reviewed_by', 'synced_at',
        'shift_ulid',
        'voided_at', 'voided_by', 'void_reason', 'void_authorized_by', 'refunded_cents',
        'items', 'payments', 'refunds',
    ];
}

/**
 * The Phase 7 fields of an `Order` that was neither voided nor refunded (without `refunds`,
 * which comes after `items` and `payments`).
 *
 * @return array<string, mixed>
 */
function unreversedOrderFields(): array
{
    return [
        'voided_at' => null,
        'voided_by' => null,
        'void_reason' => null,
        'void_authorized_by' => null,
        'refunded_cents' => 0,
    ];
}

/**
 * The contract's `OrderSummary` keys, in order (Phase 5 adds `order_no` and the offline
 * fields, Phase 6 `shift_ulid`, Phase 7 `refunded_cents`).
 *
 * @return list<string>
 */
function orderSummaryKeys(): array
{
    return [
        'ulid', 'invoice_no', 'order_no', 'queue_no', 'table_no', 'business_date', 'status', 'placed_at',
        'cashier', 'customer', 'items_count', 'total_cents', 'payment_methods',
        'source', 'needs_review', 'review_reasons', 'reviewed_at', 'reviewed_by', 'synced_at',
        'shift_ulid', 'refunded_cents', 'has_sc_pwd',
    ];
}

/**
 * The Phase 5 fields of an online sale's `Order` / `OrderSummary`.
 *
 * @return array<string, mixed>
 */
function onlineOrderFields(): array
{
    return [
        'source' => 'online',
        'needs_review' => false,
        'review_reasons' => [],
        'reviewed_at' => null,
        'reviewed_by' => null,
        'synced_at' => null,
    ];
}

/**
 * The keys of an `Order` line, in order (`category_id` since Phase 4; `refunded_qty` and
 * `refunded_cents` since Phase 7).
 *
 * @return list<string>
 */
function orderItemKeys(): array
{
    return [
        'id', 'product_id', 'product_name', 'category_id', 'category_name', 'sku', 'qty', 'unit_price_cents',
        'gross_cents', 'is_vatable', 'discount', 'line_discount_cents', 'order_discount_share_cents',
        'line_total_cents', 'notes', 'refunded_qty', 'refunded_cents',
        'sc_pwd', 'sc_pwd_eligible_cents', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents',
    ];
}

/**
 * Recursively sort an array by key. MySQL's JSON type does not keep key order,
 * so audit `changes` are compared key-sorted (values still compared strictly).
 *
 * @param  array<array-key, mixed>|null  $array
 * @return array<array-key, mixed>|null
 */
function ksortDeep(?array $array): ?array
{
    if ($array === null) {
        return null;
    }

    ksort($array);

    return array_map(fn ($value) => is_array($value) ? ksortDeep($value) : $value, $array);
}

/*
|--------------------------------------------------------------------------
| Phase 4: printing
|--------------------------------------------------------------------------
*/

/**
 * The contract's `Printer` keys, in order.
 *
 * @return list<string>
 */
function printerKeys(): array
{
    return [
        'id', 'name', 'role', 'host', 'port', 'paper_width_mm', 'is_enabled', 'is_default_kitchen',
        'category_ids', 'created_at', 'updated_at',
    ];
}

/**
 * The contract's `BranchSettings` keys, in order.
 *
 * @return list<string>
 */
function branchSettingsKeys(): array
{
    return [
        'receipt_header_lines', 'receipt_footer_lines', 'auto_print_receipt', 'receipt_copies',
        'print_kitchen_tickets', 'updated_at',
    ];
}

/*
|--------------------------------------------------------------------------
| Phase 5: offline sales
|--------------------------------------------------------------------------
*/

/**
 * POST /api/v1/devices/register with the given token.
 */
function registerDevice(string $token, ?string $installId = null, array $overrides = []): TestResponse
{
    return test()->withToken($token)->postJson('/api/v1/devices/register', array_replace([
        'install_id' => $installId ?? newUlid(),
        'name' => 'Galaxy Tab A9+',
        'app_version' => '1.0.0',
    ], $overrides));
}

/**
 * A new token for the user, bound to a device registered (or re-registered) with the
 * given install id, as the app does right after login.
 */
function deviceToken(User $user, ?string $installId = null): string
{
    $token = tokenFor($user);
    registerDevice($token, $installId)->assertOk();

    return $token;
}

/**
 * A valid `OfflineOrder`: whole-price lines at the products' current prices (the snapshot),
 * paid exactly in cash, rung up by the cashier half an hour ago. Each call gets the next
 * `order_no` of device T01 for 2026-09-26.
 *
 * @param  list<array{0: Product, 1: int}>  $lines
 * @return array<string, mixed>
 */
function offlineOrder(User $cashier, array $lines, array $overrides = []): array
{
    static $sequence = 0;
    $sequence++;

    $total = array_sum(array_map(fn (array $line) => $line[0]->price_cents * $line[1], $lines));

    return array_replace([
        'ulid' => newUlid(),
        'order_no' => sprintf('T01-20260926-%04d', $sequence),
        'placed_at' => now()->subMinutes(30)->toIso8601ZuluString(),
        'cashier_id' => $cashier->id,
        'shift_ulid' => testShiftUlid(),
        'customer_id' => null,
        'notes' => null,
        'table_no' => null,
        'items' => array_map(fn (array $line) => [
            'product_id' => $line[0]->id,
            'qty' => $line[1],
            'unit_price_cents' => $line[0]->price_cents,
            'discount' => null,
            'notes' => null,
        ], $lines),
        'discount' => null,
        'payments' => $total > 0 ? [['method' => 'cash', 'amount_cents' => $total, 'reference_no' => null]] : [],
        'client_total_cents' => $total,
    ], $overrides);
}

/**
 * POST /api/v1/sync/orders with the given token.
 *
 * @param  list<mixed>  $orders
 */
function syncOrders(string $token, array $orders): TestResponse
{
    return test()->withToken($token)->postJson('/api/v1/sync/orders', ['orders' => $orders]);
}

/*
|--------------------------------------------------------------------------
| Phase 6: shifts and reports
|--------------------------------------------------------------------------
*/

/**
 * A valid POST /shifts body: opened now by the given user with a ₱2,000.00 float.
 *
 * @return array<string, mixed>
 */
function shiftBody(User $opener, array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'opened_at' => now()->toIso8601ZuluString(),
        'opened_by' => $opener->id,
        'opening_float_cents' => 200000,
    ], $overrides);
}

function postShift(string $token, array $body): TestResponse
{
    return test()->withToken($token)->postJson('/api/v1/shifts', $body);
}

/**
 * Open a shift through the API (201) and return its `Shift` JSON.
 *
 * @return array<string, mixed>
 */
function openShift(string $token, User $opener, array $overrides = []): array
{
    return postShift($token, shiftBody($opener, $overrides))->assertCreated()->json('data');
}

/**
 * A valid cash movement body: ₱500.00 in, now, by the given user.
 *
 * @return array<string, mixed>
 */
function cashMovementBody(User $user, array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'type' => 'in',
        'amount_cents' => 50000,
        'reason' => 'Change fund top-up',
        'occurred_at' => now()->toIso8601ZuluString(),
        'user_id' => $user->id,
    ], $overrides);
}

function postCashMovement(string $token, string $shiftUlid, array $body): TestResponse
{
    return test()->withToken($token)->postJson("/api/v1/shifts/{$shiftUlid}/cash-movements", $body);
}

/**
 * A valid close body: closed now by the given user.
 *
 * @return array<string, mixed>
 */
function closeBody(User $closer, int $countedCashCents, array $overrides = []): array
{
    return array_replace([
        'closed_at' => now()->toIso8601ZuluString(),
        'closed_by' => $closer->id,
        'counted_cash_cents' => $countedCashCents,
        'close_note' => null,
    ], $overrides);
}

function postClose(string $token, string $shiftUlid, array $body): TestResponse
{
    return test()->withToken($token)->postJson("/api/v1/shifts/{$shiftUlid}/close", $body);
}

/**
 * The contract's `Shift` keys, in order.
 *
 * @return list<string>
 */
function shiftKeys(): array
{
    return [
        'ulid', 'status', 'device', 'opened_at', 'opened_by', 'opening_float_cents',
        'closed_at', 'closed_by', 'counted_cash_cents', 'close_note', 'flags', 'report', 'synced_at',
    ];
}

/**
 * The contract's `ShiftReport` keys, in order.
 *
 * @return list<string>
 */
function shiftReportKeys(): array
{
    return [
        'orders_count', 'items_sold', 'gross_sales_cents', 'discounts_cents', 'net_sales_cents',
        'vatable_sales_cents', 'vat_amount_cents', 'vat_exempt_sales_cents',
        'sc_pwd_orders_count', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents', 'by_payment_method',
        'voids_count', 'voids_cents', 'refunds_count', 'refunds_cents', 'refunds_by_method', 'net_after_refunds_cents',
        'cash_in_cents', 'cash_out_cents', 'expected_cash_cents', 'variance_cents', 'by_cashier',
        'needs_review_count',
    ];
}

/**
 * The Phase 7 fields of a `ShiftReport` without voids or refunds.
 *
 * @return array<string, mixed>
 */
function noShiftReversals(int $netSalesCents): array
{
    return [
        'voids_count' => 0, 'voids_cents' => 0, 'refunds_count' => 0, 'refunds_cents' => 0,
        'refunds_by_method' => [
            ['method' => 'cash', 'amount_cents' => 0],
            ['method' => 'gcash', 'amount_cents' => 0],
        ],
        'net_after_refunds_cents' => $netSalesCents,
    ];
}

/**
 * The SC/PWD figures of a `ShiftReport`, sales report `totals` or dashboard `sales` without
 * SC/PWD sales (they follow the VAT figures).
 *
 * @return array{sc_pwd_orders_count: int, sc_pwd_vat_relief_cents: int, sc_pwd_discount_cents: int}
 */
function noScPwdFigures(): array
{
    return ['sc_pwd_orders_count' => 0, 'sc_pwd_vat_relief_cents' => 0, 'sc_pwd_discount_cents' => 0];
}

/**
 * The SC/PWD fields of an `Order` line without SC/PWD (after `refunded_cents`).
 *
 * @return array{sc_pwd: bool, sc_pwd_eligible_cents: int, sc_pwd_vat_relief_cents: int, sc_pwd_discount_cents: int}
 */
function noScPwdLine(): array
{
    return ['sc_pwd' => false, 'sc_pwd_eligible_cents' => 0, 'sc_pwd_vat_relief_cents' => 0, 'sc_pwd_discount_cents' => 0];
}

/**
 * The report of a shift with no sales and no cash movements.
 *
 * @return array<string, mixed>
 */
function emptyShiftReport(int $openingFloatCents, ?int $varianceCents = null): array
{
    return [
        'orders_count' => 0, 'items_sold' => 0,
        'gross_sales_cents' => 0, 'discounts_cents' => 0, 'net_sales_cents' => 0,
        'vatable_sales_cents' => 0, 'vat_amount_cents' => 0, 'vat_exempt_sales_cents' => 0,
        ...noScPwdFigures(),
        'by_payment_method' => [
            ['method' => 'cash', 'orders_count' => 0, 'amount_cents' => 0],
            ['method' => 'gcash', 'orders_count' => 0, 'amount_cents' => 0],
        ],
        ...noShiftReversals(0),
        'cash_in_cents' => 0, 'cash_out_cents' => 0,
        'expected_cash_cents' => $openingFloatCents, 'variance_cents' => $varianceCents,
        'by_cashier' => [],
        'needs_review_count' => 0,
    ];
}

/*
|--------------------------------------------------------------------------
| Phase 7: voids and refunds
|--------------------------------------------------------------------------
*/

/**
 * A valid void body: a reason, no manager approval.
 *
 * @return array<string, mixed>
 */
function voidBody(array $overrides = []): array
{
    return array_replace(['reason' => 'Customer cancelled', 'authorization' => null], $overrides);
}

/**
 * POST /api/v1/orders/{ulid}/void with the given token and a new `Idempotency-Key` unless given.
 */
function postVoid(string $token, string $orderUlid, array $body, ?string $key = null): TestResponse
{
    return test()->withToken($token)->postJson(
        "/api/v1/orders/{$orderUlid}/void",
        $body,
        ['Idempotency-Key' => $key ?? newUlid()],
    );
}

/**
 * A refund body for the given lines (`[order_item_id, qty]` pairs), paid back in the given
 * payments, with `client_refund_cents` = their sum unless overridden.
 *
 * @param  list<array{0: int, 1: int}>  $lines
 * @param  list<array{method: string, amount_cents: int, reference_no?: string|null}>  $payments
 * @return array<string, mixed>
 */
function refundBody(string $shiftUlid, array $lines, array $payments, array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'shift_ulid' => $shiftUlid,
        'reason' => 'Wrong drink',
        'items' => array_map(fn (array $line) => ['order_item_id' => $line[0], 'qty' => $line[1]], $lines),
        'payments' => array_map(fn (array $payment) => ['reference_no' => null, ...$payment], $payments),
        'client_refund_cents' => array_sum(array_column($payments, 'amount_cents')),
        'authorization' => null,
    ], $overrides);
}

/**
 * POST /api/v1/orders/{ulid}/refunds with the given token and `Idempotency-Key` = the body's
 * `ulid` unless given.
 */
function postRefund(string $token, string $orderUlid, array $body, ?string $key = null): TestResponse
{
    return test()->withToken($token)->postJson(
        "/api/v1/orders/{$orderUlid}/refunds",
        $body,
        ['Idempotency-Key' => $key ?? ($body['ulid'] ?? '')],
    );
}

/**
 * The contract's `Refund` keys, in order.
 *
 * @return list<string>
 */
function refundKeys(): array
{
    return [
        'ulid', 'business_date', 'refunded_at', 'shift_ulid', 'refunded_by', 'authorized_by', 'reason',
        'amount_cents', 'vatable_sales_cents', 'vat_amount_cents', 'vat_exempt_sales_cents', 'items', 'payments',
    ];
}

/**
 * The reconciliation invariants of the Phase 7 contract (*Data model*), over the whole
 * database:
 *
 * - every stock level equals the sum of its ledger;
 * - per order: refunded_cents = Σ refunds.amount_cents = Σ items.refunded_cents ≤ total_cents;
 * - per refund: Σ refund_payments = amount_cents;
 * - per order and method: the refunds never exceed what that method paid.
 */
function expectReconciled(): void
{
    $ledger = DB::table('stock_movements')
        ->groupBy('branch_id', 'product_id', 'ingredient_id')
        ->select(['branch_id', 'product_id', 'ingredient_id'])
        ->selectRaw('SUM(qty_delta) AS qty')
        ->get()
        ->mapWithKeys(fn (object $row) => ["{$row->branch_id}-{$row->product_id}-{$row->ingredient_id}" => (string) $row->qty]);
    $levels = DB::table('stock_levels')->get()
        ->mapWithKeys(fn (object $row) => ["{$row->branch_id}-{$row->product_id}-{$row->ingredient_id}" => (string) $row->qty]);

    expect($levels->sortKeys()->all())->toBe($ledger->sortKeys()->all());

    foreach (DB::table('orders')->get() as $order) {
        $refunds = (int) DB::table('refunds')->where('order_id', $order->id)->sum('amount_cents');
        $lines = (int) DB::table('order_items')->where('order_id', $order->id)->sum('refunded_cents');

        expect((int) $order->refunded_cents)->toBe($refunds)
            ->and($lines)->toBe($refunds)
            ->and($refunds)->toBeLessThanOrEqual((int) $order->total_cents);

        foreach (['cash', 'gcash'] as $method) {
            $paid = (int) DB::table('payments')->where('order_id', $order->id)->where('method', $method)->sum('amount_cents');
            $back = (int) DB::table('refund_payments')
                ->join('refunds', 'refunds.id', '=', 'refund_payments.refund_id')
                ->where('refunds.order_id', $order->id)
                ->where('refund_payments.method', $method)
                ->sum('refund_payments.amount_cents');

            expect($back)->toBeLessThanOrEqual($paid);
        }
    }

    foreach (DB::table('refunds')->get() as $refund) {
        expect((int) DB::table('refund_payments')->where('refund_id', $refund->id)->sum('amount_cents'))->toBe((int) $refund->amount_cents);
    }
}

/**
 * A sales report row (Phase 6; Phase 7 adds `refunded_qty`, null except on product and
 * category rows, `refunds_cents` and `net_after_refunds_cents`).
 *
 * @return array<string, mixed>
 */
function reportRow(string $key, string $label, int $orders, ?int $qty, ?int $gross, ?int $discounts, int $net, ?int $refundedQty = null, int $refunds = 0): array
{
    return [
        'key' => $key, 'label' => $label, 'orders_count' => $orders, 'qty' => $qty,
        'gross_sales_cents' => $gross, 'discounts_cents' => $discounts, 'net_sales_cents' => $net,
        'refunded_qty' => $refundedQty, 'refunds_cents' => $refunds, 'net_after_refunds_cents' => $net - $refunds,
    ];
}

/**
 * The Phase 7 totals of a sales report: voids and refunds.
 *
 * @return array<string, int>
 */
function reportReversals(int $net, int $voids = 0, int $voidsCents = 0, int $refunds = 0, int $refundsCents = 0): array
{
    return [
        'voids_count' => $voids,
        'voids_cents' => $voidsCents,
        'refunds_count' => $refunds,
        'refunds_cents' => $refundsCents,
        'net_after_refunds_cents' => $net - $refundsCents,
    ];
}

/*
|--------------------------------------------------------------------------
| Ingredients, Recipes & Purchasing
|--------------------------------------------------------------------------
*/

/**
 * The contract's `Ingredient` keys, in order (`image_path` per Global Conventions → File uploads).
 *
 * @return list<string>
 */
function ingredientKeys(): array
{
    return [
        'id', 'name', 'base_unit', 'base_unit_locked', 'image_url', 'image_path', 'is_active', 'units',
        'qty', 'reorder_level', 'status', 'avg_cost', 'stock_value_cents', 'last_movement_at',
    ];
}

/**
 * The `Supplier` keys, in order.
 *
 * @return list<string>
 */
function supplierKeys(): array
{
    return ['id', 'name', 'contact_person', 'contact_number', 'email', 'address', 'is_active', 'created_at', 'updated_at'];
}

/**
 * An ingredient with its own units (`[name => factor]`).
 *
 * @param  array<string, string>  $units
 */
function makeIngredient(string $name, string $baseUnit = 'g', array $units = [], array $attributes = []): Ingredient
{
    return Ingredient::factory()->withUnits($units)->create(['name' => $name, 'base_unit' => $baseUnit, ...$attributes])->refresh();
}

function makeSupplier(string $name = 'Metro Supply', array $attributes = []): Supplier
{
    return Supplier::factory()->create(['name' => $name, ...$attributes]);
}

/**
 * Write one ingredient movement directly (the way every stock change is written): a receipt of
 * `$baseQty` base units costing `$costCents` (the weighted average moves), or any other type
 * valued at the current average.
 */
function ingredientMovement(Ingredient $ingredient, string $type, string $baseQty, ?int $costCents = null, ?Branch $branch = null, ?string $occurredAt = null): StockMovement
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();

    return DB::transaction(fn () => app(RecordStockMovementAction::class)->executeForIngredient(
        level: StockLevel::lockOrCreateIngredient($branch->id, $ingredient->id),
        type: $type,
        qtyDelta: BigDecimal::of($baseQty),
        valueCents: $costCents,
        unitCostCents: null,
        actor: null,
        occurredAt: $occurredAt === null ? now() : CarbonImmutable::parse($occurredAt, 'UTC'),
    ));
}

/**
 * The branch's level of an ingredient (null when it was never stocked there).
 */
function ingredientLevel(Ingredient $ingredient, ?Branch $branch = null): ?StockLevel
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();

    return StockLevel::query()->where('branch_id', $branch->id)->where('ingredient_id', $ingredient->id)->first();
}

/**
 * The ledger invariants of an ingredient in a branch: the level's qty is the sum of its movements,
 * and the stock value round_half_up(max(qty, 0) × avg_cost) stays within one centavo per movement
 * of Σ value_cents.
 */
function expectIngredientLedgerConsistent(Ingredient $ingredient, ?Branch $branch = null): void
{
    $branch ??= Branch::query()->orderBy('id')->firstOrFail();
    $level = ingredientLevel($ingredient, $branch);
    $movements = StockMovement::query()->where('branch_id', $branch->id)->where('ingredient_id', $ingredient->id);

    $sum = BigDecimal::of((string) ((clone $movements)->sum('qty_delta') ?: '0'));
    expect(BigDecimal::of((string) $level->qty)->isEqualTo($sum))->toBeTrue();

    $value = (int) (clone $movements)->sum('value_cents');
    $stockValue = Quantity::roundToInt(Quantity::max(BigDecimal::of((string) $level->qty), BigDecimal::zero())->multipliedBy((string) $level->avg_cost));

    expect(abs($stockValue - $value))->toBeLessThanOrEqual(max(1, (clone $movements)->count()));
}

/**
 * A purchase request item body.
 *
 * @return array<string, mixed>
 */
function prItem(Ingredient|Product $item, Supplier $supplier, string|int|float $qty, string $unit, array $overrides = []): array
{
    return [
        'item_type' => $item instanceof Ingredient ? 'ingredient' : 'product',
        'item_id' => $item->id,
        'supplier_id' => $supplier->id,
        'qty' => $qty,
        'unit' => $unit,
        'estimated_unit_price_cents' => null,
        'remarks' => null,
        ...$overrides,
    ];
}

/**
 * A purchase request body with the given items.
 *
 * @param  list<array<string, mixed>>  $items
 * @return array<string, mixed>
 */
function prBody(array $items, array $overrides = []): array
{
    return ['ulid' => newUlid(), 'date_needed' => null, 'remarks' => null, 'items' => $items, ...$overrides];
}

/**
 * POST /api/v1/purchase-requests with `Idempotency-Key` = the body's `ulid` unless given.
 */
function postPurchaseRequest(User $user, array $body, ?string $key = null): TestResponse
{
    return test()->withToken(tokenFor($user))->postJson('/api/v1/purchase-requests', $body, ['Idempotency-Key' => $key ?? ($body['ulid'] ?? '')]);
}

/**
 * Create a PR through the API and return its JSON.
 *
 * @param  list<array<string, mixed>>  $items
 * @return array<string, mixed>
 */
function createPurchaseRequest(User $user, array $items, array $overrides = []): array
{
    return postPurchaseRequest($user, prBody($items, $overrides))->assertCreated()->json('data');
}

/**
 * POST /api/v1/purchase-requests/{ulid}/decisions.
 *
 * @param  list<array<string, mixed>>  $decisions
 */
function decidePurchaseRequest(User $user, string $ulid, array $decisions): TestResponse
{
    return test()->withToken(tokenFor($user))->postJson("/api/v1/purchase-requests/{$ulid}/decisions", ['decisions' => $decisions]);
}

/**
 * Approve every item of a PR (as `$approver`) and return the PR JSON.
 *
 * @param  array<string, mixed>  $pr
 * @return array<string, mixed>
 */
function approveAllItems(User $approver, array $pr): array
{
    return decidePurchaseRequest($approver, $pr['ulid'], array_map(
        fn (array $item) => ['item_id' => $item['id'], 'decision' => 'approved'],
        $pr['items'],
    ))->assertOk()->json('data');
}

/**
 * A PR requested by `$requester`, approved in full by `$approver`, its PO approved by `$approver`:
 * the approved PO's JSON.
 *
 * @param  list<array<string, mixed>>  $items  PR item bodies (with prices, so the ₱0 gate passes)
 * @return array<string, mixed>
 */
function approvedPurchaseOrder(User $requester, User $approver, array $items): array
{
    $pr = approveAllItems($approver, createPurchaseRequest($requester, $items));

    return test()->withToken(tokenFor($approver))
        ->postJson("/api/v1/purchase-orders/{$pr['purchase_order']['ulid']}/approve")
        ->assertOk()
        ->json('data');
}

/**
 * POST /api/v1/purchase-orders/{ulid}/receipts with `Idempotency-Key` = the body's `ulid`.
 *
 * @param  list<array<string, mixed>>  $lines
 */
function postReceipt(User $user, string $poUlid, array $lines, ?string $ulid = null, ?string $remarks = null): TestResponse
{
    $body = ['ulid' => $ulid ?? newUlid(), 'remarks' => $remarks, 'lines' => $lines];

    return test()->withToken(tokenFor($user))->postJson("/api/v1/purchase-orders/{$poUlid}/receipts", $body, ['Idempotency-Key' => $body['ulid']]);
}
