<?php

namespace Database\Seeders;

use App\Actions\Inventory\RecordStockMovementAction;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Customer;
use App\Models\Device;
use App\Models\Printer;
use App\Models\PrintRoute;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockLevel;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Local development data. Never runs outside the `local` environment. Idempotent.
 */
class DevSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment('local')) {
            $this->command?->warn('DevSeeder skipped: only runs in the local environment.');

            return;
        }

        $branch = Branch::query()->updateOrCreate(['code' => 'MAIN'], [
            'name' => 'Main Branch',
            'timezone' => 'Asia/Manila',
            'day_start_time' => '04:00:00',
            'is_active' => true,
        ]);

        Device::query()->updateOrCreate(['code' => 'TAB01'], [
            'branch_id' => $branch->id,
            'name' => 'Counter Tablet 1',
            'is_active' => true,
        ]);

        $roleIds = Role::query()->pluck('id', 'slug');

        // Seeded accounts keep the password `password` (the policy applies to new passwords only).
        $users = [
            ['email' => 'owner@pos.test', 'name' => 'Olivia Owner', 'role' => 'owner', 'is_active' => true, 'pin' => null],
            ['email' => 'manager@pos.test', 'name' => 'Marco Manager', 'role' => 'manager', 'is_active' => true, 'pin' => '2468'],
            ['email' => 'manager2@pos.test', 'name' => 'Mika Manager', 'role' => 'manager', 'is_active' => true, 'pin' => '2580'],
            ['email' => 'cashier@pos.test', 'name' => 'Carla Cashier', 'role' => 'cashier', 'is_active' => true, 'pin' => '1357'],
            ['email' => 'inactive@pos.test', 'name' => 'Ivan Inactive', 'role' => 'cashier', 'is_active' => false, 'pin' => null],
        ];

        foreach ($users as $userData) {
            $user = User::query()->updateOrCreate(['email' => $userData['email']], [
                'branch_id' => $branch->id,
                'role_id' => $roleIds[$userData['role']],
                'name' => $userData['name'],
                'password' => 'password',
                'is_active' => $userData['is_active'],
            ]);

            // Re-hash only when the PIN is missing or different, so re-seeding is a no-op.
            if ($userData['pin'] !== null && ($user->pin_hash === null || ! Hash::check($userData['pin'], $user->pin_hash))) {
                $user->forceFill(['pin_hash' => Hash::make($userData['pin'])])->save();
            }
        }

        $ownerId = User::query()->where('email', 'owner@pos.test')->value('id');

        $this->seedCatalogue($ownerId);
        $this->seedCustomers($ownerId);
        $this->seedOpeningStock($branch, User::query()->find($ownerId));
        $this->seedPrinters($branch, $ownerId);
    }

    /**
     * The contract's dev printers in MAIN (Phase 4), only when `DEV_PRINTER_HOST` is set:
     * Counter (cashier, 9100), Kitchen (9101, the default kitchen printer, with Breakfast
     * and Meals) and Bar (9102, with Drinks), all 80 mm and enabled, at that host. Re-seeding
     * updates them in place (e.g. a new host) and never duplicates them or their routes.
     */
    private function seedPrinters(Branch $branch, ?int $ownerId): void
    {
        $host = config('pos.dev_printer_host');

        if (! is_string($host) || trim($host) === '') {
            return;
        }

        $printers = [
            ['name' => 'Counter', 'role' => Printer::ROLE_CASHIER, 'port' => 9100, 'is_default_kitchen' => false, 'categories' => []],
            ['name' => 'Kitchen', 'role' => Printer::ROLE_KITCHEN, 'port' => 9101, 'is_default_kitchen' => true, 'categories' => ['Breakfast', 'Meals']],
            ['name' => 'Bar', 'role' => Printer::ROLE_BAR, 'port' => 9102, 'is_default_kitchen' => false, 'categories' => ['Drinks']],
        ];

        foreach ($printers as $printerData) {
            if ($printerData['is_default_kitchen']) {
                // At most one default kitchen printer per branch.
                Printer::query()
                    ->where('branch_id', $branch->id)
                    ->where('name', '!=', $printerData['name'])
                    ->update(['is_default_kitchen' => false]);
            }

            $printer = Printer::query()->firstOrNew(['branch_id' => $branch->id, 'name' => $printerData['name']]);
            $printer->fill([
                'role' => $printerData['role'],
                'host' => trim($host),
                'port' => $printerData['port'],
                'paper_width_mm' => 80,
                'is_enabled' => true,
                'is_default_kitchen' => $printerData['is_default_kitchen'],
            ]);
            $printer->forceFill([
                'branch_id' => $branch->id,
                'created_by' => $printer->created_by ?? $ownerId,
                'updated_by' => $printer->updated_by ?? $ownerId,
            ])->save();

            // One route per category and branch: an existing route moves to this printer.
            $routes = Category::query()
                ->whereIn('name', $printerData['categories'])
                ->pluck('id')
                ->map(fn (int $categoryId) => [
                    'branch_id' => $branch->id,
                    'category_id' => $categoryId,
                    'printer_id' => $printer->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ])
                ->all();

            if ($routes !== []) {
                PrintRoute::query()->upsert($routes, ['branch_id', 'category_id'], ['printer_id', 'updated_at']);
            }
        }
    }

    /**
     * Opening stock of the `track_stock` dev products in MAIN (Phase 3): an `opening`
     * movement plus the level, written together like any stock change. A product that
     * already has an opening movement is left alone, so re-seeding never adds stock.
     * No orders are seeded, so no sales figure is ever invented.
     */
    private function seedOpeningStock(Branch $branch, ?User $owner): void
    {
        $openingStock = ['DRK-001' => 50, 'DRK-002' => 30]; // Iced Tea, Bottled Water

        $recordMovement = app(RecordStockMovementAction::class);

        foreach ($openingStock as $sku => $qty) {
            $product = Product::query()->where('sku', $sku)->first();

            if ($product === null) {
                continue;
            }

            $opened = StockMovement::query()
                ->where('branch_id', $branch->id)
                ->where('product_id', $product->id)
                ->where('type', StockMovement::TYPE_OPENING)
                ->exists();

            if ($opened) {
                continue;
            }

            DB::transaction(function () use ($branch, $product, $qty, $owner, $recordMovement): void {
                $recordMovement->execute(
                    level: StockLevel::lockOrCreate($branch->id, $product->id),
                    type: StockMovement::TYPE_OPENING,
                    qtyDelta: $qty,
                    unitCostCents: $product->cost_cents,
                    actor: $owner,
                    occurredAt: now()->startOfSecond(),
                    reason: 'Opening stock',
                );
            });
        }
    }

    /**
     * The contract's dev customers (global, not branch-scoped).
     */
    private function seedCustomers(?int $ownerId): void
    {
        $customers = [
            ['first_name' => 'Maria', 'last_name' => 'Santos', 'contact' => '0917 123 4567', 'email' => null],
            ['first_name' => 'Juan', 'last_name' => 'Dela Cruz', 'contact' => '0918 765 4321', 'email' => 'juan@example.com'],
            ['first_name' => 'Ana', 'last_name' => 'Reyes', 'contact' => null, 'email' => null],
        ];

        foreach ($customers as $customerData) {
            $customer = Customer::query()->firstOrNew([
                'first_name' => $customerData['first_name'],
                'last_name' => $customerData['last_name'],
            ]);
            $customer->fill(['contact' => $customerData['contact'], 'email' => $customerData['email']]);
            $customer->forceFill([
                'created_by' => $customer->created_by ?? $ownerId,
                'updated_by' => $customer->updated_by ?? $ownerId,
            ])->save();
        }
    }

    /**
     * The contract's dev menu: three categories and five products, no images.
     * Prices are VAT-inclusive centavos; costs are about 45% of price.
     */
    private function seedCatalogue(?int $ownerId): void
    {
        $menu = [
            ['name' => 'Breakfast', 'sort_order' => 10, 'products' => [
                ['sku' => 'BRK-001', 'name' => 'Egg with Rice', 'price_cents' => 5000, 'cost_cents' => 2250, 'track_stock' => false],
                ['sku' => 'BRK-002', 'name' => 'Hot Dog', 'price_cents' => 8000, 'cost_cents' => 3600, 'track_stock' => false],
            ]],
            ['name' => 'Meals', 'sort_order' => 20, 'products' => [
                ['sku' => 'MEA-001', 'name' => 'Fried Chicken', 'price_cents' => 10000, 'cost_cents' => 4500, 'track_stock' => false],
            ]],
            ['name' => 'Drinks', 'sort_order' => 30, 'products' => [
                ['sku' => 'DRK-001', 'name' => 'Iced Tea', 'price_cents' => 3500, 'cost_cents' => 1575, 'track_stock' => true],
                ['sku' => 'DRK-002', 'name' => 'Bottled Water', 'price_cents' => 2000, 'cost_cents' => 900, 'track_stock' => true],
            ]],
        ];

        foreach ($menu as $categoryData) {
            $category = Category::query()->firstOrNew(['name' => $categoryData['name']]);
            $category->fill(['sort_order' => $categoryData['sort_order'], 'is_active' => true]);
            $category->forceFill([
                'created_by' => $category->created_by ?? $ownerId,
                'updated_by' => $category->updated_by ?? $ownerId,
            ])->save();

            foreach ($categoryData['products'] as $productData) {
                $product = Product::query()->firstOrNew(['sku' => $productData['sku']]);
                $product->fill([
                    'category_id' => $category->id,
                    'name' => $productData['name'],
                    'price_cents' => $productData['price_cents'],
                    'cost_cents' => $productData['cost_cents'],
                    'is_vatable' => true,
                    'is_available' => true,
                    'track_stock' => $productData['track_stock'],
                    'sort_order' => 0,
                ]);
                $product->forceFill([
                    'created_by' => $product->created_by ?? $ownerId,
                    'updated_by' => $product->updated_by ?? $ownerId,
                ])->save();
            }
        }
    }
}
