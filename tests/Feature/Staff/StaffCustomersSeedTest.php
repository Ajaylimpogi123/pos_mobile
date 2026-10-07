<?php

use App\Models\Customer;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\DevSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Support\Facades\Hash;

beforeEach(function () {
    seedRoles();
});

/**
 * @return list<string>
 */
function roleSlugsWithPermission(string $permission): array
{
    return Role::query()
        ->whereHas('permissions', fn ($query) => $query->where('slug', $permission))
        ->orderBy('id')
        ->pluck('slug')
        ->all();
}

it('grants customer.manage to owner and manager only (21 permissions since Ingredients & Purchasing)', function () {
    expect(Permission::query()->count())->toBe(21)
        ->and(Permission::query()->where('slug', 'customer.manage')->value('description'))->toBe('Delete customer records')
        ->and(roleSlugsWithPermission('customer.manage'))->toBe(['owner', 'manager']);
});

it('adds customer.manage to an existing database when re-seeded', function () {
    // Simulate a database seeded before Phase 1b.
    Permission::query()->where('slug', 'customer.manage')->delete();
    expect(roleSlugsWithPermission('customer.manage'))->toBe([]);

    $this->seed(RolesAndPermissionsSeeder::class);
    $this->seed(RolesAndPermissionsSeeder::class);

    expect(Permission::query()->where('slug', 'customer.manage')->count())->toBe(1)
        ->and(roleSlugsWithPermission('customer.manage'))->toBe(['owner', 'manager']);
});

it('keeps the purchasing approvals owner-only (contract v1.20.2)', function () {
    expect(roleSlugsWithPermission('purchase.approve'))->toBe(['owner'])
        ->and(roleSlugsWithPermission('purchase.approve_own'))->toBe(['owner'])
        ->and(roleSlugsWithPermission('purchase.request'))->toBe(['owner', 'manager'])
        ->and(roleSlugsWithPermission('purchase.receive'))->toBe(['owner', 'manager']);
});

it('removes purchase.approve from an existing Manager role when re-seeded', function () {
    // Simulate a database seeded before v1.20.2, when the Manager could approve.
    $manager = Role::query()->where('slug', 'manager')->sole();
    $manager->permissions()->attach(Permission::query()->where('slug', 'purchase.approve')->value('id'));
    expect(roleSlugsWithPermission('purchase.approve'))->toBe(['owner', 'manager']);

    $this->seed(RolesAndPermissionsSeeder::class);

    expect(roleSlugsWithPermission('purchase.approve'))->toBe(['owner'])
        ->and(Permission::query()->where('slug', 'purchase.approve')->count())->toBe(1)
        ->and($manager->fresh()->permissionSlugs())->toHaveCount(18)->not->toContain('purchase.approve')
        ->and(Role::query()->where('slug', 'owner')->sole()->permissionSlugs())->toHaveCount(21);
});

it('seeds the Phase 1b staff PINs, manager2 and the customers in the local environment, idempotently', function () {
    app()['env'] = 'local';

    $this->seed(DevSeeder::class);

    $pinHashes = User::query()->pluck('pin_hash', 'email');

    $this->seed(DevSeeder::class);

    $users = User::query()->with('role')->get()->keyBy('email');

    expect($users->keys()->sort()->values()->all())->toBe([
        'cashier@pos.test', 'inactive@pos.test', 'manager2@pos.test', 'manager@pos.test', 'owner@pos.test',
    ]);

    expect($users['manager2@pos.test']->role->slug)->toBe('manager')
        ->and($users['manager2@pos.test']->is_active)->toBeTrue()
        ->and(Hash::check('password', $users['manager2@pos.test']->password))->toBeTrue()
        ->and(Hash::check('2580', $users['manager2@pos.test']->pin_hash))->toBeTrue()
        ->and(Hash::check('2468', $users['manager@pos.test']->pin_hash))->toBeTrue()
        ->and(Hash::check('1357', $users['cashier@pos.test']->pin_hash))->toBeTrue()
        ->and($users['owner@pos.test']->pin_hash)->toBeNull()
        ->and($users['inactive@pos.test']->pin_hash)->toBeNull();

    // A second run does not re-hash the PINs.
    expect(User::query()->pluck('pin_hash', 'email')->all())->toBe($pinHashes->all());

    $customers = Customer::query()->orderBy('first_name')->get()
        ->map(fn (Customer $c) => [$c->full_name, $c->contact, $c->email])
        ->all();

    expect($customers)->toBe([
        ['Ana Reyes', null, null],
        ['Juan Dela Cruz', '0918 765 4321', 'juan@example.com'],
        ['Maria Santos', '0917 123 4567', null],
    ]);
});

it('seeds no staff or customers outside the local environment', function () {
    $this->seed(DevSeeder::class);

    expect(User::query()->count())->toBe(0)
        ->and(Customer::query()->count())->toBe(0);
});
