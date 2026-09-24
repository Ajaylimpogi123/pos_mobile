<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

/**
 * Roles and permissions: identical in every environment. Idempotent.
 */
class RolesAndPermissionsSeeder extends Seeder
{
    /**
     * @var array<string, string>
     */
    public const PERMISSIONS = [
        'branch.all' => 'Act across all branches (owner override of branch scoping)',
        'discount.apply' => 'Apply a discount within the role limit',
        'discount.override' => 'Authorize a discount above another user\'s limit',
        'inventory.adjust' => 'Adjust stock levels',
        'product.manage' => 'Create and edit products and categories',
        'report.view' => 'View reports',
        'report.zread' => 'Run the Z-read (end-of-day) report',
        'sale.create' => 'Ring up sales',
        'sale.refund' => 'Refund a completed sale',
        'sale.void' => 'Void a completed sale',
        'shift.close' => 'Close a cash shift',
        'shift.open' => 'Open a cash shift',
        'user.manage' => 'Manage staff accounts',
    ];

    public function run(): void
    {
        $permissionIds = [];

        foreach (self::PERMISSIONS as $slug => $description) {
            $permissionIds[$slug] = Permission::query()
                ->updateOrCreate(['slug' => $slug], ['description' => $description])
                ->id;
        }

        $roles = [
            'owner' => [
                'name' => 'Owner',
                'is_admin' => true,
                'max_discount_percent' => 100,
                'permissions' => array_keys(self::PERMISSIONS),
            ],
            'manager' => [
                'name' => 'Manager',
                'is_admin' => true,
                'max_discount_percent' => 100,
                'permissions' => array_values(array_diff(array_keys(self::PERMISSIONS), ['branch.all'])),
            ],
            'cashier' => [
                'name' => 'Cashier',
                'is_admin' => false,
                // Placeholder: confirm with the business owner.
                'max_discount_percent' => 10,
                'permissions' => ['sale.create', 'discount.apply', 'shift.open', 'shift.close'],
            ],
        ];

        foreach ($roles as $slug => $definition) {
            $role = Role::query()->updateOrCreate(['slug' => $slug], [
                'name' => $definition['name'],
                'is_admin' => $definition['is_admin'],
                'max_discount_percent' => $definition['max_discount_percent'],
            ]);

            $role->permissions()->sync(
                array_map(fn (string $permission) => $permissionIds[$permission], $definition['permissions'])
            );
        }
    }
}
