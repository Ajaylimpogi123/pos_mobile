<?php

use App\Actions\Audit\RecordAuditLog;
use App\Actions\Customers\DeleteCustomerAction;
use App\Actions\Staff\CreateStaffUserAction;
use App\Actions\Staff\ResetStaffPasswordAction;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Permission;
use App\Models\Product;
use App\Models\Role;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->otherBranch = Branch::factory()->create(['code' => 'NORTH']);

    // 2026-09-24 15:00 in Manila: business day 2026-09-24.
    Carbon::setTestNow('2026-09-24 07:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner', 'last_login_at' => now()->subHour()]);
    $this->owner->forceFill(['pin_hash' => Hash::make('1470')])->save();
});

afterEach(function () {
    Carbon::setTestNow();
});

function dashboard(User $user): TestResponse
{
    return test()->withToken(tokenFor($user))->getJson('/api/v1/dashboard');
}

/**
 * Write an audit entry at a given time (UTC).
 *
 * @param  array<string, mixed>|null  $changes
 */
function auditAt(string $action, ?User $actor, string $at, ?Model $subject = null, ?array $changes = null): AuditLog
{
    $entry = new AuditLog;
    $entry->forceFill([
        'actor_id' => $actor?->id,
        'action' => $action,
        'subject_type' => $subject?->getMorphClass(),
        'subject_id' => $subject?->getKey(),
        'changes' => $changes,
        'created_at' => Carbon::parse($at, 'UTC'),
    ])->save();

    return $entry;
}

/**
 * A role granting exactly the given permission slugs.
 *
 * @param  list<string>  $slugs
 */
function roleWith(string $slug, array $slugs): Role
{
    $role = Role::factory()->create(['slug' => $slug, 'name' => ucfirst($slug)]);
    $role->permissions()->sync(Permission::query()->whereIn('slug', $slugs)->pluck('id'));

    return $role;
}

/**
 * @return list<array{date: string, count: int}>
 */
function week(array $counts): array
{
    $dates = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];

    return array_map(fn (string $date) => ['date' => $date, 'count' => $counts[$date] ?? 0], $dates);
}

describe('auth', function () {
    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/dashboard')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('returns 401 with an invalid token', function () {
        $this->withToken('1|not-a-real-token')->getJson('/api/v1/dashboard')->assertUnauthorized();
    });
});

describe('shape and gating', function () {
    beforeEach(function () {
        // Something for every insight, so hidden sections would show up if they leaked.
        $category = Category::factory()->create(['name' => 'Drinks']);
        Category::factory()->create(['name' => 'Empty']);
        Product::factory()->forCategory($category)->unavailable()->create(['price_cents' => 1000, 'cost_cents' => 0]);
        Product::factory()->forCategory($category)->create(['price_cents' => 1000, 'cost_cents' => 900]);
        userWithRole('cashier');
        Customer::factory()->create();
    });

    it('shows every section to an owner and a manager', function (string $role) {
        $caller = $role === 'owner' ? $this->owner : userWithRole('manager', ['last_login_at' => now()]);

        $response = dashboard($caller)->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe([
                'generated_at', 'business_date', 'catalog', 'staff', 'customers', 'activity', 'sales', 'insights',
            ])
            ->and(array_keys($response->json('data.catalog')))->toBe([
                'products_total', 'products_available', 'products_unavailable', 'products_without_image',
                'products_tracking_stock', 'products_without_cost', 'categories_total', 'categories_active',
                'categories_empty', 'average_margin_bps', 'low_margin_threshold_bps', 'low_margin_products', 'by_category',
            ])
            ->and(array_keys($response->json('data.catalog.low_margin_products.0')))->toBe([
                'id', 'name', 'category_name', 'price_cents', 'cost_cents', 'margin_bps',
            ])
            ->and(array_keys($response->json('data.catalog.by_category.0')))->toBe([
                'category_id', 'name', 'is_active', 'products_total', 'products_available', 'average_margin_bps',
            ])
            ->and(array_keys($response->json('data.staff')))->toBe([
                'total', 'active', 'inactive', 'without_pin', 'never_logged_in', 'by_role', 'recent_logins',
            ])
            ->and(array_keys($response->json('data.staff.by_role.0')))->toBe(['role_id', 'slug', 'name', 'count'])
            ->and(array_keys($response->json('data.staff.recent_logins.0')))->toBe(['user_id', 'name', 'role_name', 'last_login_at'])
            ->and(array_keys($response->json('data.customers')))->toBe(['total', 'new_last_7_days', 'new_last_30_days'])
            ->and(array_keys($response->json('data.activity')))->toBe(['logins_by_day', 'changes_by_day', 'recent_changes'])
            ->and(array_keys($response->json('data.insights.0')))->toBe(['key', 'severity', 'title', 'message', 'count', 'action'])
            // Phase 3: `sales` replaces the reserved null (report.view); see DashboardSalesTest.
            ->and(array_keys($response->json('data.sales')))->toBe([
                // v1.28: Dashboard Period Filter
                'period', 'date_from', 'date_to',
                'business_date',
                'trend',
                'orders_count', 'items_sold', 'gross_sales_cents', 'discounts_cents',
                'net_sales_cents', 'vat_amount_cents',
                // SC/PWD
                'sc_pwd_orders_count', 'sc_pwd_vat_relief_cents', 'sc_pwd_discount_cents', 'service_charge_cents',
                'average_order_cents',
                // Phase 7
                'voids_count', 'refunds_cents', 'net_after_refunds_cents',
                'by_payment_method',
                'last_7_days', 'top_products',
            ]);

        $response->assertJsonPath('data.generated_at', '2026-09-24T07:00:00Z')
            ->assertJsonPath('data.business_date', '2026-09-24')
            ->assertJsonPath('data.sales.business_date', '2026-09-24')
            ->assertJsonPath('data.sales.orders_count', 0)
            ->assertJsonPath('data.catalog.low_margin_threshold_bps', 3000);

        expect(collect($response->json('data.insights'))->pluck('key')->all())->toBe([
            'low_margin_products', 'products_without_cost', 'staff_without_pin',
            'categories_empty', 'products_unavailable', 'products_without_image', 'staff_never_logged_in',
        ]);
    })->with(['owner', 'manager']);

    it('shows a cashier only customers, with no insights from hidden sections', function () {
        $response = dashboard(userWithRole('cashier'))->assertOk();

        $response->assertJsonPath('data.catalog', null)
            ->assertJsonPath('data.staff', null)
            ->assertJsonPath('data.activity', null)
            ->assertJsonPath('data.sales', null)
            ->assertJsonPath('data.insights', [])
            ->assertJsonPath('data.customers', ['total' => 1, 'new_last_7_days' => 1, 'new_last_30_days' => 1])
            ->assertJsonPath('data.business_date', '2026-09-24');

        // Every key is present, even when null.
        expect(array_keys($response->json('data')))->toBe([
            'generated_at', 'business_date', 'catalog', 'staff', 'customers', 'activity', 'sales', 'insights',
        ]);
    });

    it('gates staff and activity/catalog independently', function () {
        $reporter = User::factory()->forBranch($this->branch)->create(['role_id' => roleWith('reporter', ['report.view'])->id]);
        $staffAdmin = User::factory()->forBranch($this->branch)->create(['role_id' => roleWith('staffer', ['user.manage'])->id]);

        $reports = dashboard($reporter)->assertOk();
        expect($reports->json('data.catalog'))->not->toBeNull()
            ->and($reports->json('data.activity'))->not->toBeNull()
            ->and($reports->json('data.staff'))->toBeNull()
            ->and(collect($reports->json('data.insights'))->pluck('key')->all())->toBe([
                'low_margin_products', 'products_without_cost',
                'categories_empty', 'products_unavailable', 'products_without_image',
            ]);

        $staff = dashboard($staffAdmin)->assertOk();
        expect($staff->json('data.catalog'))->toBeNull()
            ->and($staff->json('data.activity'))->toBeNull()
            ->and($staff->json('data.staff'))->not->toBeNull()
            ->and(collect($staff->json('data.insights'))->pluck('key')->all())->toBe([
                'staff_without_pin', 'staff_never_logged_in',
            ]);
    });
});

describe('catalog', function () {
    it('computes exact figures, margins, the low-margin list and categories', function () {
        $seasonal = Category::factory()->inactive()->create(['name' => 'Seasonal', 'sort_order' => 5]);
        $breakfast = Category::factory()->create(['name' => 'Breakfast', 'sort_order' => 10]);
        $drinks = Category::factory()->create(['name' => 'Drinks', 'sort_order' => 20]);
        $retired = Category::factory()->create(['name' => 'Retired', 'sort_order' => 30]);
        $empty = Category::factory()->create(['name' => 'Empty', 'sort_order' => 30]);
        $freebies = Category::factory()->create(['name' => 'Freebies', 'sort_order' => 50]);
        Category::factory()->create(['name' => 'Gone', 'sort_order' => 1])->delete();

        $make = fn (Category $category, string $name, int $price, int $cost, array $extra = []) => Product::factory()
            ->forCategory($category)
            ->create(['name' => $name, 'price_cents' => $price, 'cost_cents' => $cost, ...$extra]);

        // Breakfast: two at 55.00%, one with price 0 (excluded from margins).
        $make($breakfast, 'Egg with Rice', 5000, 2250);
        $make($breakfast, 'Hot Dog', 8000, 3600, ['image_path' => 'products/1/a.jpg']);
        $make($breakfast, 'Free Rice', 0, 100);

        // Drinks
        $icedTea = $make($drinks, 'Iced Tea', 3500, 2800, ['image_path' => 'products/2/b.jpg', 'track_stock' => true]); // 2000
        $make($drinks, 'Lemonade', 3000, 2001);                              // 3330
        $make($drinks, 'Soda', 2000, 0, ['is_available' => false]);          // no cost: excluded
        $lossLeader = $make($drinks, 'Loss Leader', 1000, 1300);             // -3000
        $oddNegative = $make($drinks, 'Odd Negative', 3000, 3001);           // -3.33 → -3 (toward zero)
        $tea = $make($drinks, 'Tea', 4000, 2900);                            // 2750
        $coffee = $make($drinks, 'Coffee', 4000, 2900);                      // 2750 (ties Tea; Coffee first by name)
        $make($drinks, 'Juice', 5000, 3600);                                 // 2800: low, but 6th, so capped out
        $make($drinks, 'Exact Thirty', 10000, 7000);                         // 3000: not below the threshold

        // Seasonal (inactive category)
        $make($seasonal, 'Mango Shake', 6000, 3000, ['is_available' => false, 'track_stock' => true]); // 5000

        // Freebies: nothing qualifies for a margin.
        $make($freebies, 'Free Sample', 0, 0);

        // Retired: only a soft-deleted product, so the category is empty.
        $make($retired, 'Old Pie', 1000, 100)->delete();

        $catalog = dashboard($this->owner)->assertOk()->json('data.catalog');

        // Qualifying margins: 5500, 5500, 2000, 3330, -3000, -3, 2750, 2750, 2800, 3000, 5000 = 29627 / 11.
        expect($catalog)->toBe([
            'products_total' => 14,
            'products_available' => 12,
            'products_unavailable' => 2,
            'products_without_image' => 12,
            'products_tracking_stock' => 2,
            'products_without_cost' => 2,
            'categories_total' => 6,
            'categories_active' => 5,
            'categories_empty' => 2,
            'average_margin_bps' => 2693,
            'low_margin_threshold_bps' => 3000,
            'low_margin_products' => [
                ['id' => $lossLeader->id, 'name' => 'Loss Leader', 'category_name' => 'Drinks', 'price_cents' => 1000, 'cost_cents' => 1300, 'margin_bps' => -3000],
                ['id' => $oddNegative->id, 'name' => 'Odd Negative', 'category_name' => 'Drinks', 'price_cents' => 3000, 'cost_cents' => 3001, 'margin_bps' => -3],
                ['id' => $icedTea->id, 'name' => 'Iced Tea', 'category_name' => 'Drinks', 'price_cents' => 3500, 'cost_cents' => 2800, 'margin_bps' => 2000],
                ['id' => $coffee->id, 'name' => 'Coffee', 'category_name' => 'Drinks', 'price_cents' => 4000, 'cost_cents' => 2900, 'margin_bps' => 2750],
                ['id' => $tea->id, 'name' => 'Tea', 'category_name' => 'Drinks', 'price_cents' => 4000, 'cost_cents' => 2900, 'margin_bps' => 2750],
            ],
            'by_category' => [
                ['category_id' => $seasonal->id, 'name' => 'Seasonal', 'is_active' => false, 'products_total' => 1, 'products_available' => 0, 'average_margin_bps' => 5000],
                ['category_id' => $breakfast->id, 'name' => 'Breakfast', 'is_active' => true, 'products_total' => 3, 'products_available' => 3, 'average_margin_bps' => 5500],
                // 2000 + 3330 - 3000 - 3 + 2750 + 2750 + 2800 + 3000 = 13627 / 8 = 1703
                ['category_id' => $drinks->id, 'name' => 'Drinks', 'is_active' => true, 'products_total' => 9, 'products_available' => 8, 'average_margin_bps' => 1703],
                ['category_id' => $empty->id, 'name' => 'Empty', 'is_active' => true, 'products_total' => 0, 'products_available' => 0, 'average_margin_bps' => null],
                ['category_id' => $retired->id, 'name' => 'Retired', 'is_active' => true, 'products_total' => 0, 'products_available' => 0, 'average_margin_bps' => null],
                ['category_id' => $freebies->id, 'name' => 'Freebies', 'is_active' => true, 'products_total' => 1, 'products_available' => 1, 'average_margin_bps' => null],
            ],
        ]);

        // The insight counts every low-margin product (6), not only the 5 listed.
        $insights = collect(dashboard($this->owner)->json('data.insights'))->keyBy('key');
        expect($insights['low_margin_products']['count'])->toBe(6)
            ->and($insights['low_margin_products']['title'])->toBe('6 products are below a 30% margin');
    });

    it('has a null average margin and no low-margin products when nothing qualifies', function () {
        $category = Category::factory()->create();
        Product::factory()->forCategory($category)->create(['price_cents' => 1000, 'cost_cents' => 0]);
        Product::factory()->forCategory($category)->create(['price_cents' => 0, 'cost_cents' => 500]);

        dashboard($this->owner)->assertOk()
            ->assertJsonPath('data.catalog.average_margin_bps', null)
            ->assertJsonPath('data.catalog.low_margin_products', [])
            ->assertJsonPath('data.catalog.by_category.0.average_margin_bps', null);
    });

    it('is all zeros on an empty catalogue', function () {
        dashboard($this->owner)->assertOk()
            ->assertJsonPath('data.catalog.products_total', 0)
            ->assertJsonPath('data.catalog.products_unavailable', 0)
            ->assertJsonPath('data.catalog.categories_total', 0)
            ->assertJsonPath('data.catalog.average_margin_bps', null)
            ->assertJsonPath('data.catalog.by_category', []);
    });
});

describe('staff', function () {
    it('counts users of the caller\'s branch only, with every role', function () {
        // Owner (caller): active, PIN, logged in.
        $manager = userWithRole('manager', ['name' => 'Marco Manager']);                       // no PIN, never logged in
        $cashier = userWithRole('cashier', ['name' => 'Carla Cashier', 'last_login_at' => now()->subMinutes(5)]); // no PIN
        userWithRole('cashier', ['name' => 'Ivan Inactive', 'is_active' => false]);           // inactive: not in PIN/login counts
        userWithRole('manager', ['name' => 'Deleted Dan', 'last_login_at' => now()])->delete(); // soft-deleted: excluded

        // Another branch: excluded everywhere.
        User::factory()->forBranch($this->otherBranch)->withRole('cashier')->create(['last_login_at' => now()]);
        User::factory()->forBranch($this->otherBranch)->withRole('owner')->create();

        $empty = Role::factory()->create(['slug' => 'auditor', 'name' => 'Auditor']);

        $staff = dashboard($this->owner)->assertOk()->json('data.staff');

        expect($staff)->toBe([
            'total' => 4,
            'active' => 3,
            'inactive' => 1,
            'without_pin' => 2,
            'never_logged_in' => 1,
            'by_role' => [
                ['role_id' => Role::query()->where('slug', 'owner')->value('id'), 'slug' => 'owner', 'name' => 'Owner', 'count' => 1],
                ['role_id' => Role::query()->where('slug', 'manager')->value('id'), 'slug' => 'manager', 'name' => 'Manager', 'count' => 1],
                ['role_id' => Role::query()->where('slug', 'cashier')->value('id'), 'slug' => 'cashier', 'name' => 'Cashier', 'count' => 2],
                ['role_id' => $empty->id, 'slug' => 'auditor', 'name' => 'Auditor', 'count' => 0],
            ],
            'recent_logins' => [
                ['user_id' => $cashier->id, 'name' => 'Carla Cashier', 'role_name' => 'Cashier', 'last_login_at' => '2026-09-24T06:55:00Z'],
                ['user_id' => $this->owner->id, 'name' => 'Olivia Owner', 'role_name' => 'Owner', 'last_login_at' => '2026-09-24T06:00:00Z'],
            ],
        ]);

        expect($manager->exists)->toBeTrue();
    });

    it('lists the 5 most recent logins, newest first', function () {
        $users = collect(range(1, 6))->map(fn (int $i) => userWithRole('cashier', [
            'name' => "Cashier {$i}",
            'last_login_at' => now()->subMinutes(10 * $i),
        ]));

        $logins = dashboard($this->owner)->assertOk()->json('data.staff.recent_logins');

        // Cashier 1..5 (10..50 minutes ago) beat the owner (60 minutes ago) and Cashier 6.
        expect(collect($logins)->pluck('user_id')->all())->toBe($users->take(5)->pluck('id')->all())
            ->and($logins[0]['last_login_at'])->toBe('2026-09-24T06:50:00Z');
    });
});

describe('customers', function () {
    it('counts non-deleted customers and rolling 7 and 30 day windows', function () {
        $at = fn (string $modifier) => ['created_at' => now()->modify($modifier), 'updated_at' => now()->modify($modifier)];

        Customer::factory()->create($at('-1 day'));
        Customer::factory()->create($at('-7 days'));            // on the 7-day boundary: counted
        Customer::factory()->create($at('-7 days -1 second'));  // just outside 7 days
        Customer::factory()->create($at('-30 days'));           // on the 30-day boundary: counted
        Customer::factory()->create($at('-31 days'));           // outside both windows
        Customer::factory()->create($at('-1 hour'))->delete();  // soft-deleted: excluded

        dashboard($this->owner)->assertOk()
            ->assertJsonPath('data.customers', ['total' => 5, 'new_last_7_days' => 2, 'new_last_30_days' => 4]);
    });
});

describe('activity by business day', function () {
    it('buckets logins and changes into exactly 7 zero-filled business days', function () {
        Carbon::setTestNow('2026-09-24 03:30:00'); // 11:30 in Manila: business day the 24th

        $cashier = userWithRole('cashier');
        $gone = userWithRole('cashier');
        $outsider = User::factory()->forBranch($this->otherBranch)->withRole('owner')->create();

        auditAt('auth.login', $cashier, '2026-09-23 20:00:00');         // 04:00 on the 24th → 24th
        auditAt('auth.login', $cashier, '2026-09-23 19:59:59');         // 03:59:59 on the 24th → 23rd
        auditAt('auth.logout', $cashier, '2026-09-23 21:00:00');        // auth.*: neither series
        auditAt('product.updated', $this->owner, '2026-09-23 23:59:59'); // 07:59:59 on the 24th (UTC 23rd) → 24th
        auditAt('product.updated', $this->owner, '2026-09-24 00:00:00'); // UTC midnight → still the 24th
        auditAt('user.pin_set', $gone, '2026-09-20 05:00:00');           // actor later soft-deleted: still counted
        auditAt('product.created', $this->owner, '2026-09-17 20:00:00'); // 04:00 on the 18th: oldest bucket
        auditAt('product.created', $this->owner, '2026-09-17 19:59:59'); // the 17th: outside the window
        auditAt('product.created', $outsider, '2026-09-24 01:00:00');    // another branch: excluded
        auditAt('product.created', null, '2026-09-24 01:00:00');         // no actor: excluded
        auditAt('product.created', $this->owner, '2026-09-24 20:00:00'); // tomorrow's business day: excluded
        $gone->delete();

        $activity = dashboard($this->owner)->assertOk()->assertJsonPath('data.business_date', '2026-09-24')->json('data.activity');

        expect($activity['logins_by_day'])->toBe(week(['2026-09-23' => 1, '2026-09-24' => 1]))
            ->and($activity['changes_by_day'])->toBe(week(['2026-09-18' => 1, '2026-09-20' => 1, '2026-09-24' => 2]));
    });

    it('returns 7 zero entries when there is no activity', function () {
        $activity = dashboard($this->owner)->assertOk()->json('data.activity');

        expect($activity['logins_by_day'])->toBe(week([]))
            ->and($activity['changes_by_day'])->toBe(week([]))
            ->and($activity['recent_changes'])->toBe([]);
    });

    it('uses the business date, not the calendar date, around the day start', function (string $now, string $businessDate, string $oldest) {
        Carbon::setTestNow($now);

        $response = dashboard($this->owner)->assertOk()->assertJsonPath('data.business_date', $businessDate);

        expect($response->json('data.activity.logins_by_day'))->toHaveCount(7)
            ->and($response->json('data.activity.logins_by_day.0.date'))->toBe($oldest)
            ->and($response->json('data.activity.logins_by_day.6.date'))->toBe($businessDate);
    })->with([
        '03:59 Manila on the 25th' => ['2026-09-24 19:59:00', '2026-09-24', '2026-09-18'],
        '04:00 Manila on the 25th' => ['2026-09-24 20:00:00', '2026-09-25', '2026-09-19'],
        'Manila midnight' => ['2026-09-24 16:00:00', '2026-09-24', '2026-09-18'],
        'UTC midnight (08:00 Manila)' => ['2026-09-25 00:00:00', '2026-09-25', '2026-09-19'],
    ]);

    it('follows the branch timezone and day start', function () {
        $this->branch->forceFill(['timezone' => 'UTC', 'day_start_time' => '00:00:00'])->save();
        Carbon::setTestNow('2026-09-24 23:59:59');

        auditAt('auth.login', $this->owner, '2026-09-24 00:00:00');
        auditAt('auth.login', $this->owner, '2026-09-23 23:59:59');

        dashboard($this->owner)->assertOk()
            ->assertJsonPath('data.business_date', '2026-09-24')
            ->assertJsonPath('data.activity.logins_by_day.6', ['date' => '2026-09-24', 'count' => 1])
            ->assertJsonPath('data.activity.logins_by_day.5', ['date' => '2026-09-23', 'count' => 1]);
    });
});

describe('recent changes', function () {
    it('lists the 8 newest non-auth changes of the branch with human summaries and no secrets', function () {
        $manager = userWithRole('manager', ['name' => 'Marco Manager']);
        $carla = userWithRole('cashier', ['name' => 'Carla Cashier']);
        $outsider = User::factory()->forBranch($this->otherBranch)->withRole('owner')->create();
        $audit = app(RecordAuditLog::class);

        $category = Category::factory()->create(['name' => 'Breakfast']);
        $egg = Product::factory()->forCategory($category)->create(['name' => 'Egg with Rice']);
        $pedro = Customer::factory()->create(['first_name' => 'Pedro', 'last_name' => 'Penduko']);

        // Oldest first; each a second apart so the order is deterministic.
        $tick = function () {
            Carbon::setTestNow(now()->addSecond());
        };

        $audit->execute('product.created', $manager, $egg, ['name' => ['from' => null, 'to' => 'Egg with Rice']]); // dropped by the limit
        $tick();
        $audit->execute('product.updated', $manager, $egg, ['price_cents' => ['from' => 5000, 'to' => 5500]]);
        $tick();
        $created = app(CreateStaffUserAction::class)->execute([
            'name' => 'Test Cashier', 'email' => 'test.cashier@pos.test', 'password' => 'Sup3rSecretPass',
            'role_id' => $carla->role_id, 'pin' => '7391',
        ], $manager); // user.created + user.pin_set
        $tick();
        app(ResetStaffPasswordAction::class)->execute($carla, 'An0therSecretPass', $manager);
        $tick();
        app(DeleteCustomerAction::class)->execute($pedro, $manager); // subject soft-deleted
        $tick();
        $audit->execute('auth.login', $manager, $manager);            // auth.*: excluded
        $audit->execute('product.created', $outsider, $egg);           // another branch: excluded
        // A hand-written entry carrying secrets: none may reach the response.
        $audit->execute('user.updated', $manager, $carla, [
            'password' => ['from' => 'OldLeak1Pass', 'to' => 'LeakedPass1'],
            'pin' => '8642',
            'pin_hash' => $carla->fresh()->password,
        ]);
        $tick();
        // Subject rows gone for good: fall back to the snapshot, then to a generic noun.
        $pie = Product::factory()->forCategory($category)->create(['name' => 'Old Pie']);
        $audit->execute('product.deleted', $manager, $pie, ['name' => 'Old Pie', 'sku' => null]);
        $pie->forceDelete();
        $tick();
        $ghost = Category::factory()->create(['name' => 'Ghost']);
        $audit->execute('category.updated', $manager, $ghost, ['is_active' => ['from' => true, 'to' => false]]);
        $ghost->forceDelete();
        $tick();
        // An action the summaries don't know (`shift.*` is left out of the feed since Phase 6).
        $audit->execute('purchase.approved', $manager);

        $response = dashboard($this->owner)->assertOk();
        $changes = $response->json('data.activity.recent_changes');

        expect($changes)->toHaveCount(8)
            ->and(array_keys($changes[0]))->toBe(['id', 'action', 'summary', 'actor_name', 'created_at'])
            ->and(collect($changes)->map(fn (array $c) => [$c['action'], $c['summary']])->all())->toBe([
                ['purchase.approved', 'Purchase approved'],
                ['category.updated', 'Updated a category'],
                ['product.deleted', 'Deleted product "Old Pie"'],
                ['user.updated', 'Updated staff account "Carla Cashier"'],
                ['customer.deleted', 'Deleted customer "Pedro Penduko"'],
                ['user.password_reset', 'Reset the password of "Carla Cashier"'],
                ['user.pin_set', 'Set the PIN of "Test Cashier"'],
                ['user.created', 'Created staff account "Test Cashier"'],
            ])
            ->and(collect($changes)->pluck('actor_name')->unique()->all())->toBe(['Marco Manager'])
            ->and($changes[0]['created_at'])->toBe(now()->toIso8601ZuluString());

        // The product.updated entry is 9th, so it is cut by the limit of 8.
        expect(collect($changes)->pluck('action'))->not->toContain('product.updated');

        $body = $response->getContent();
        foreach (['Sup3rSecretPass', 'An0therSecretPass', 'LeakedPass1', 'OldLeak1Pass', '7391', '8642', '$2y$', 'pin_hash', 'revoked_tokens'] as $secret) {
            expect(str_contains($body, $secret))->toBeFalse("The response leaks {$secret}");
        }

        expect($created->pin_hash)->not->toBeNull();
    });

    it('uses the live name of a renamed or soft-deleted subject', function () {
        $category = Category::factory()->create(['name' => 'Breakfast']);
        $product = Product::factory()->forCategory($category)->create(['name' => 'Egg with Rice']);

        app(RecordAuditLog::class)->execute('product.image_updated', $this->owner, $product, ['image_path' => ['from' => null, 'to' => 'x.jpg']]);
        Carbon::setTestNow(now()->addSecond());
        app(RecordAuditLog::class)->execute('category.image_removed', $this->owner, $category);

        $product->forceFill(['name' => 'Egg & Rice'])->save();
        $product->delete();

        $summaries = collect(dashboard($this->owner)->assertOk()->json('data.activity.recent_changes'))->pluck('summary')->all();

        expect($summaries)->toBe([
            'Removed the photo of category "Breakfast"',
            'Updated the photo of product "Egg & Rice"',
        ]);
    });
});

describe('insights', function () {
    it('uses singular titles for a count of 1, with the contract keys, severities and actions', function () {
        $solo = Category::factory()->create(['name' => 'Solo']);
        Category::factory()->create(['name' => 'Empty']);
        Product::factory()->forCategory($solo)->unavailable()->create(['price_cents' => 1000, 'cost_cents' => 0, 'image_path' => 'p/1.jpg']);
        Product::factory()->forCategory($solo)->create(['price_cents' => 1000, 'cost_cents' => 900]);
        userWithRole('cashier'); // active, no PIN, never logged in

        expect(dashboard($this->owner)->assertOk()->json('data.insights'))->toBe([
            ['key' => 'low_margin_products', 'severity' => 'warning', 'title' => '1 product is below a 30% margin',
                'message' => 'Review the price or cost of these products to protect your profit.', 'count' => 1, 'action' => 'menu.products'],
            ['key' => 'products_without_cost', 'severity' => 'warning', 'title' => '1 product has no cost',
                'message' => 'Add a cost to each product so its margin can be tracked.', 'count' => 1, 'action' => 'menu.products'],
            ['key' => 'staff_without_pin', 'severity' => 'warning', 'title' => '1 active staff member has no PIN',
                'message' => 'Set a PIN for each active staff member so they are ready for quick switching.', 'count' => 1, 'action' => 'staff'],
            ['key' => 'categories_empty', 'severity' => 'info', 'title' => '1 category has no products',
                'message' => 'Add products to empty categories or remove them to keep the menu tidy.', 'count' => 1, 'action' => 'menu.categories'],
            ['key' => 'products_unavailable', 'severity' => 'info', 'title' => '1 product is unavailable',
                'message' => 'Unavailable products cannot be sold until they are marked available again.', 'count' => 1, 'action' => 'menu.products'],
            ['key' => 'products_without_image', 'severity' => 'info', 'title' => '1 product has no photo',
                'message' => 'Photos make the menu faster to scan at the counter.', 'count' => 1, 'action' => 'menu.products'],
            ['key' => 'staff_never_logged_in', 'severity' => 'info', 'title' => '1 active staff member has never logged in',
                'message' => 'Check that these staff members have their login details.', 'count' => 1, 'action' => 'staff'],
        ]);
    });

    it('uses plural titles for counts above 1', function () {
        $category = Category::factory()->create();
        Category::factory()->count(2)->create();
        Product::factory()->forCategory($category)->unavailable()->count(2)->create(['price_cents' => 1000, 'cost_cents' => 0, 'image_path' => 'p/1.jpg']);
        Product::factory()->forCategory($category)->count(3)->create(['price_cents' => 1000, 'cost_cents' => 900]);
        userWithRole('cashier');
        userWithRole('manager');

        $titles = collect(dashboard($this->owner)->assertOk()->json('data.insights'))->pluck('title', 'key')->all();

        expect($titles)->toBe([
            'low_margin_products' => '3 products are below a 30% margin',
            'products_without_cost' => '2 products have no cost',
            'staff_without_pin' => '2 active staff members have no PIN',
            'categories_empty' => '2 categories have no products',
            'products_unavailable' => '2 products are unavailable',
            'products_without_image' => '3 products have no photo',
            'staff_never_logged_in' => '2 active staff members have never logged in',
        ]);
    });

    it('is empty when there is nothing to flag', function () {
        $category = Category::factory()->create();
        Product::factory()->forCategory($category)->create(['price_cents' => 1000, 'cost_cents' => 400, 'image_path' => 'p/1.jpg']);
        userWithRole('cashier', ['is_active' => false]); // inactive: never counted

        dashboard($this->owner)->assertOk()->assertJsonPath('data.insights', []);
    });
});

/**
 * A catalogue, staff, customers and audit trail of the given size.
 */
function dashboardFixture(int $size): void
{
    $categories = Category::factory()->count($size)->create();
    foreach ($categories as $category) {
        Product::factory()->forCategory($category)->count($size)->create();
    }
    $staff = collect(range(1, $size))->map(fn () => userWithRole('cashier', ['last_login_at' => now()]));
    Customer::factory()->count($size)->create();

    $audit = app(RecordAuditLog::class);
    foreach ($staff as $user) {
        $audit->execute('auth.login', $user, $user);
        $audit->execute('product.updated', $user, Product::query()->inRandomOrder()->first());
        $audit->execute('category.updated', $user, $categories->random());
        $audit->execute('customer.updated', $user, Customer::query()->inRandomOrder()->first());
        $audit->execute('user.updated', $user, $user);
    }
}

/**
 * The number of SQL queries one dashboard request runs (token issued beforehand).
 */
function dashboardQueryCount(User $caller): int
{
    $token = tokenFor($caller);
    DB::flushQueryLog();
    DB::enableQueryLog();

    test()->withToken($token)->getJson('/api/v1/dashboard')->assertOk();

    $count = count(DB::getQueryLog());
    DB::disableQueryLog();

    return $count;
}

describe('performance', function () {
    it('runs a small, fixed number of queries whatever the data size', function () {
        dashboardFixture(3);
        $small = dashboardQueryCount($this->owner);

        dashboardFixture(12);
        $large = dashboardQueryCount($this->owner);

        // Auth + permissions (~5) + catalog 3 + staff 3 + customers 1 + activity 2 + one per subject type (≤ 4)
        // + sales 4 (Phase 3) + the stock alerts 1 (Inventory) + the ingredient alerts 1 and the
        // purchasing queues 3 (Ingredients, Recipes & Purchasing) + the unsynced tablets 1 (Hardening & Pilot).
        expect($small)->toBeLessThanOrEqual(30)
            ->and($large)->toBe($small);
    });
});
