<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

/**
 * Roles and permissions: identical in every environment. Idempotent: re-running it on
 * an existing database adds new permissions (e.g. `customer.manage`, `settings.manage`, `order.review`,
 * the purchasing slugs `purchase.*` / `supplier.manage`, and `system.manage` for Owner and
 * Manager since Hardening & Pilot) and re-syncs
 * each role's grants, which also revokes grants a role no longer has (e.g. the
 * Manager's `purchase.approve`, owner-only since contract v1.20.2).
 */
class RolesAndPermissionsSeeder extends Seeder
{
    /**
     * @var array<string, string>
     */
    public const PERMISSIONS = [
        'branch.all' => 'Act across all branches (owner override of branch scoping)',
        'customer.manage' => 'Delete customer records',
        'discount.apply' => 'Apply a discount within the role limit',
        'discount.override' => 'Authorize a discount above another user\'s limit',
        'inventory.adjust' => 'Adjust stock levels',
        'order.review' => 'Review flagged offline sales',
        'product.manage' => 'Create and edit products and categories',
        'purchase.approve' => 'Decide purchase request items; approve or decline purchase orders',
        'purchase.approve_own' => 'Decide or approve a purchase request or order you created',
        'purchase.receive' => 'Record goods receipts',
        'purchase.request' => 'Create or edit purchase requests',
        'report.view' => 'View reports',
        'report.zread' => 'Run the Z-read (end-of-day) report',
        'sale.create' => 'Ring up sales',
        'sale.refund' => 'Refund a completed sale',
        'sale.void' => 'Void a completed sale',
        'settings.manage' => 'Manage printers and receipt settings',
        'shift.close' => 'Close a cash shift',
        'shift.open' => 'Open a cash shift',
        'supplier.manage' => 'Manage suppliers',
        'system.manage' => 'Manage tablets and the error log',
        'user.manage' => 'Manage staff accounts',
    ];

    /**
     * Owner-only permissions: the Manager role gets every other one (Ingredients, Recipes &
     * Purchasing, contract v1.20.2: only the Owner decides PR items and approves or declines
     * POs, including the Owner's own PRs and POs).
     */
    public const OWNER_ONLY = ['branch.all', 'purchase.approve', 'purchase.approve_own'];

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
                'permissions' => array_values(array_diff(array_keys(self::PERMISSIONS), self::OWNER_ONLY)),
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
