<?php

use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

beforeEach(function () {
    seedRoles();
    mainBranch();

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier', 'pin_hash' => Hash::make('1357')]);
    $this->inactive = userWithRole('cashier', ['name' => 'Ivan Inactive', 'is_active' => false]);

    $this->roleIds = Role::query()->pluck('id', 'slug');
});

describe('GET /admin/users (extended)', function () {
    it('returns StaffUser items with has_pin and can_manage computed for the caller', function () {
        $response = $this->withToken(tokenFor($this->manager))->getJson('/api/v1/admin/users')->assertOk();

        $items = collect($response->json('data'))->keyBy('name');

        expect(array_keys($response->json('data.0')))->toBe(staffUserKeys())
            ->and($items['Carla Cashier']['has_pin'])->toBeTrue()
            ->and($items['Ivan Inactive']['has_pin'])->toBeFalse()
            ->and($items['Olivia Owner']['can_manage'])->toBeFalse()
            ->and($items['Marco Manager']['can_manage'])->toBeTrue()
            ->and($items['Carla Cashier']['can_manage'])->toBeTrue()
            ->and($items['Ivan Inactive']['can_manage'])->toBeTrue();
    });

    it('marks everyone manageable for an owner', function () {
        $response = $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/users')->assertOk();

        expect(collect($response->json('data'))->pluck('can_manage')->unique()->all())->toBe([true]);
    });

    it('filters by role_id', function () {
        $response = $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/admin/users?role_id='.$this->roleIds['cashier'])
            ->assertOk();

        expect(collect($response->json('data'))->pluck('id')->all())->toBe([$this->cashier->id, $this->inactive->id]);
    });

    it('filters by is_active, accepting 1/0/true/false', function (string $value, bool $active) {
        $response = $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/admin/users?is_active='.$value)
            ->assertOk();

        $expected = $active
            ? [$this->cashier->id, $this->manager->id, $this->owner->id]
            : [$this->inactive->id];

        expect(collect($response->json('data'))->pluck('id')->all())->toBe($expected);
    })->with([
        ['1', true], ['true', true], ['0', false], ['false', false],
    ]);

    it('combines filters with search and keeps the pagination envelope', function () {
        $response = $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/admin/users?role_id='.$this->roleIds['cashier'].'&is_active=true&search=carla&per_page=1')
            ->assertOk()
            ->assertJsonPath('meta.per_page', 1)
            ->assertJsonPath('meta.next_cursor', null);

        expect(collect($response->json('data'))->pluck('id')->all())->toBe([$this->cashier->id]);
    });

    it('rejects invalid filters with 422', function () {
        $token = tokenFor($this->manager);

        $this->withToken($token)->getJson('/api/v1/admin/users?role_id=abc')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role_id' => 'The role id field must be an integer.']);

        $this->withToken($token)->getJson('/api/v1/admin/users?is_active=maybe')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['is_active' => 'The is active field must be true or false.']);
    });
});

describe('GET /admin/roles', function () {
    it('lists roles by id with sorted permissions and assignable for a manager', function () {
        $response = $this->withToken(tokenFor($this->manager))->getJson('/api/v1/admin/roles')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
            ->and(array_keys($response->json('data.0')))
            ->toBe(['id', 'slug', 'name', 'is_admin', 'max_discount_percent', 'permissions', 'assignable']);

        $response->assertJsonPath('meta.per_page', 100)
            ->assertJsonPath('meta.next_cursor', null)
            ->assertJsonPath('meta.path', url('/api/v1/admin/roles'))
            ->assertJsonCount(3, 'data');

        $roles = collect($response->json('data'));

        expect($roles->pluck('id')->all())->toBe($roles->pluck('id')->sort()->values()->all())
            ->and($roles->pluck('slug')->all())->toBe(['owner', 'manager', 'cashier'])
            ->and($roles->pluck('assignable', 'slug')->all())->toBe(['owner' => false, 'manager' => true, 'cashier' => true]);

        expect($roles->firstWhere('slug', 'manager'))->toBe([
            'id' => $this->roleIds['manager'],
            'slug' => 'manager',
            'name' => 'Manager',
            'is_admin' => true,
            'max_discount_percent' => 100,
            'permissions' => [
                'customer.manage', 'discount.apply', 'discount.override', 'inventory.adjust', 'order.review', 'product.manage',
                'purchase.receive', 'purchase.request',
                'report.view', 'report.zread', 'sale.create', 'sale.refund', 'sale.void',
                'settings.manage', 'shift.close', 'shift.open', 'supplier.manage', 'system.manage', 'user.manage',
            ],
            'assignable' => true,
        ]);

        expect($roles->firstWhere('slug', 'cashier')['permissions'])
            ->toBe(['discount.apply', 'sale.create', 'shift.close', 'shift.open'])
            ->and($roles->firstWhere('slug', 'owner')['permissions'])->toHaveCount(22);
    });

    it('marks every role assignable for an owner', function () {
        $response = $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/roles')->assertOk();

        expect(collect($response->json('data'))->pluck('assignable')->all())->toBe([true, true, true]);
    });

    it('paginates with a cursor', function () {
        $token = tokenFor($this->manager);

        $page1 = $this->withToken($token)->getJson('/api/v1/admin/roles?per_page=2')->assertOk();
        expect(collect($page1->json('data'))->pluck('slug')->all())->toBe(['owner', 'manager']);

        $page2 = $this->withToken($token)->getJson('/api/v1/admin/roles?per_page=2&cursor='.$page1->json('meta.next_cursor'))->assertOk();
        expect(collect($page2->json('data'))->pluck('slug')->all())->toBe(['cashier'])
            ->and($page2->json('meta.next_cursor'))->toBeNull();
    });

    it('rejects per_page above 100', function () {
        $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/admin/roles?per_page=101')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page']);
    });

    it('forbids a cashier and returns 401 without a token', function () {
        $this->withToken(tokenFor($this->cashier))
            ->getJson('/api/v1/admin/roles')
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        $this->withoutToken()->getJson('/api/v1/admin/roles')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

it('cannot see another branch\'s staff in the list', function () {
    $outsider = User::factory()->withRole('cashier')->create(['name' => 'Aaron Outsider']);

    $response = $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/users')->assertOk();

    expect(collect($response->json('data'))->pluck('id'))->not->toContain($outsider->id);
});
