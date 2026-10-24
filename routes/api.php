<?php

use App\Http\Controllers\Api\V1\Admin\CategoryController as AdminCategoryController;
use App\Http\Controllers\Api\V1\Admin\DeviceController as AdminDeviceController;
use App\Http\Controllers\Api\V1\Admin\DiningTableController;
use App\Http\Controllers\Api\V1\Admin\ErrorLogController;
use App\Http\Controllers\Api\V1\Admin\IngredientController;
use App\Http\Controllers\Api\V1\Admin\IngredientCostController;
use App\Http\Controllers\Api\V1\Admin\IngredientStockController;
use App\Http\Controllers\Api\V1\Admin\PrinterController;
use App\Http\Controllers\Api\V1\Admin\ProductController as AdminProductController;
use App\Http\Controllers\Api\V1\Admin\ProductStockController;
use App\Http\Controllers\Api\V1\Admin\RecipeController;
use App\Http\Controllers\Api\V1\Admin\RoleController;
use App\Http\Controllers\Api\V1\Admin\SettingsController;
use App\Http\Controllers\Api\V1\Admin\SupplierController;
use App\Http\Controllers\Api\V1\Admin\UserController;
use App\Http\Controllers\Api\V1\AppVersionController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CategoryController;
use App\Http\Controllers\Api\V1\ClientErrorController;
use App\Http\Controllers\Api\V1\CustomerController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\IngredientInventoryController;
use App\Http\Controllers\Api\V1\InventoryController;
use App\Http\Controllers\Api\V1\OrderController;
use App\Http\Controllers\Api\V1\PrintAgentController;
use App\Http\Controllers\Api\V1\PrintConfigController;
use App\Http\Controllers\Api\V1\PrintJobController;
use App\Http\Controllers\Api\V1\ProductController;
use App\Http\Controllers\Api\V1\PurchaseOrderController;
use App\Http\Controllers\Api\V1\PurchaseRequestController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\ShiftController;
use App\Http\Controllers\Api\V1\SyncController;
use App\Http\Controllers\Api\V1\TabController;
use App\Http\Controllers\Api\V1\TableController;
use App\Http\Controllers\Api\V1\UnitController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('v1.')->group(function () {
    // Public
    Route::post('auth/login', [AuthController::class, 'login'])
        ->middleware('throttle:login')
        ->name('auth.login');

    // Print agent (Web POS & Print Bridge → E): machine endpoints, no Sanctum. Authorized by the
    // X-Print-Agent-Token header (503 when unconfigured, 401 when wrong); throttled at 120/min.
    Route::controller(PrintAgentController::class)
        ->prefix('print-agent')
        ->name('print-agent.')
        ->middleware(['throttle:print-agent', 'print.agent'])
        ->group(function () {
            Route::get('ping', 'ping')->name('ping');
            Route::post('jobs/claim', 'claim')->name('claim');
            Route::post('jobs/{ulid}/result', 'result')->whereUlid('ulid')->name('result');
        });

    // App error reports (Hardening & Pilot → B): auth optional (a valid token records the user
    // and device); 30 requests per minute per IP, 1..20 errors each. 202.
    Route::post('client-errors', [ClientErrorController::class, 'store'])
        ->middleware('throttle:client-errors')
        ->name('client-errors.store');

    // The app versions the server announces (Hardening & Pilot → C): no auth, 60/min per IP.
    Route::get('app-version', [AppVersionController::class, 'show'])
        ->middleware('throttle:app-version')
        ->name('app-version');

    // Authenticated: a valid, unexpired token whose user is still active (and, since Hardening &
    // Pilot → C, whose device isn't retired)
    Route::middleware(['auth:sanctum', 'session.active'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me'])->name('auth.me');
        Route::post('auth/logout', [AuthController::class, 'logout'])->name('auth.logout');

        // PIN quick-switch (any authenticated user; PIN attempts limited per PIN owner)
        Route::get('auth/pin-users', [AuthController::class, 'pinUsers'])->name('auth.pin-users');
        Route::post('auth/pin', [AuthController::class, 'pin'])->name('auth.pin');

        // Sales (sale.create to ring up; history with sale.create or report.view, via OrderPolicy)
        Route::controller(OrderController::class)
            ->prefix('orders')
            ->name('orders.')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->middleware('idempotent')->name('store');
                Route::get('{ulid}', 'show')->whereUlid('ulid')->name('show');

                // Mark a flagged offline sale reviewed (Phase 5; order.review, via OrderPolicy)
                Route::post('{ulid}/review', 'review')->whereUlid('ulid')->name('review');

                // Voids and refunds (Phase 7; sale.create, sale.void / sale.refund, via OrderPolicy;
                // from the token's device; a manager PIN when the caller lacks the authority)
                Route::post('{ulid}/void', 'void')->middleware('idempotent')->whereUlid('ulid')->name('void');
                Route::post('{ulid}/refunds', 'refund')->middleware('idempotent')->whereUlid('ulid')->name('refunds.store');
            });

        // Cash shifts (Phase 6). Writes: shift.open / shift.close, from the token's device,
        // idempotent by ULID (not by the Idempotency-Key middleware). Reads: report.zread, or a
        // shift of the caller's own tablet (ShiftPolicy).
        Route::controller(ShiftController::class)
            ->prefix('shifts')
            ->name('shifts.')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->name('store');
                // The token device's open shift, or null (Q-035; any authenticated user). Before {ulid}.
                Route::get('current', 'current')->name('current');
                Route::get('{ulid}', 'show')->whereUlid('ulid')->name('show');
                Route::post('{ulid}/cash-movements', 'storeCashMovement')->whereUlid('ulid')->name('cash.store');
                Route::post('{ulid}/close', 'close')->whereUlid('ulid')->name('close');
            });

        // Sales reports and their CSV export (Phase 6; report.view, via OrderPolicy)
        Route::get('reports/sales', [ReportController::class, 'sales'])->name('reports.sales');
        Route::get('reports/sales/export', [ReportController::class, 'export'])->name('reports.sales.export');

        // Inventory report and its CSV export (Inventory, v1 completion; report.view, via ProductPolicy)
        Route::get('reports/inventory', [ReportController::class, 'inventory'])->name('reports.inventory');
        Route::get('reports/inventory/export', [ReportController::class, 'inventoryExport'])->name('reports.inventory.export');

        // Purchasing report and its CSV export (Ingredients, Recipes & Purchasing; report.view or
        // purchase.approve, via PurchaseOrderPolicy)
        Route::get('reports/purchasing', [ReportController::class, 'purchasing'])->name('reports.purchasing');
        Route::get('reports/purchasing/export', [ReportController::class, 'purchasingExport'])->name('reports.purchasing.export');

        // Ingredient inventory (Ingredients, Recipes & Purchasing), the caller's branch: reads with
        // inventory.adjust or report.view; the reorder level with inventory.adjust (IngredientPolicy)
        Route::controller(IngredientInventoryController::class)
            ->prefix('inventory/ingredients')
            ->name('inventory.ingredients.')
            ->whereNumber('ingredient')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::get('{ingredient}', 'show')->name('show');
                Route::get('{ingredient}/movements', 'movements')->name('movements');
                Route::put('{ingredient}/reorder-level', 'reorderLevel')->name('reorder-level');
            });

        // Inventory (v1 completion), the caller's branch: list and movement history with
        // inventory.adjust or report.view; the reorder level with inventory.adjust (ProductPolicy)
        Route::controller(InventoryController::class)
            ->prefix('inventory')
            ->name('inventory.')
            ->whereNumber('product')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::get('{product}', 'show')->name('show');
                Route::get('{product}/movements', 'movements')->name('movements');
                Route::put('{product}/reorder-level', 'reorderLevel')->name('reorder-level');
            });

        // The unit catalog (Ingredients, Recipes & Purchasing; any authenticated user)
        Route::get('units', [UnitController::class, 'index'])->name('units.index');

        // Purchase requests (Ingredients, Recipes & Purchasing; PurchaseRequestPolicy). `{purchaseRequest}`
        // is a ULID bound within the caller's branch (AppServiceProvider).
        Route::controller(PurchaseRequestController::class)
            ->prefix('purchase-requests')
            ->name('purchase-requests.')
            ->whereUlid('purchaseRequest')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->middleware('idempotent')->name('store');
                Route::get('{purchaseRequest}', 'show')->name('show');
                Route::patch('{purchaseRequest}', 'update')->name('update');
                Route::delete('{purchaseRequest}', 'destroy')->name('destroy');
                Route::post('{purchaseRequest}/decisions', 'decide')->name('decisions');
            });

        // Purchase orders and receiving (Ingredients, Recipes & Purchasing; PurchaseOrderPolicy).
        // `{purchaseOrder}` is a ULID bound within the caller's branch (AppServiceProvider).
        Route::controller(PurchaseOrderController::class)
            ->prefix('purchase-orders')
            ->name('purchase-orders.')
            ->whereUlid('purchaseOrder')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::get('{purchaseOrder}', 'show')->name('show');
                Route::patch('{purchaseOrder}', 'update')->name('update');
                Route::post('{purchaseOrder}/approve', 'approve')->name('approve');
                Route::post('{purchaseOrder}/decline', 'decline')->name('decline');
                Route::post('{purchaseOrder}/receipts', 'receive')->middleware('idempotent')->name('receipts.store');
            });

        // Device registration (Phase 5; any authenticated user): binds the token to the tablet
        Route::post('devices/register', [DeviceController::class, 'register'])->name('devices.register');

        // Device heartbeat (Hardening & Pilot → C; any authenticated user, a token bound to a device)
        Route::post('devices/heartbeat', [DeviceController::class, 'heartbeat'])->name('devices.heartbeat');

        // Dashboard (any authenticated user; each section is gated by permission in BuildDashboardAction)
        Route::get('dashboard', [DashboardController::class, 'show'])->name('dashboard');

        // Catalogue (POS read endpoints: any authenticated user)
        Route::get('categories', [CategoryController::class, 'index'])->name('categories.index');
        Route::get('products', [ProductController::class, 'index'])->name('products.index');

        // Catalogue sync (any authenticated user): baseline and delta pull of the menu for the device
        Route::get('sync/catalogue', [SyncController::class, 'catalogue'])->name('sync.catalogue');

        // Offline sales (Phase 5): push a batch of offline sales (sale.create, from a registered
        // device; idempotent per order by its ulid, not by the Idempotency-Key middleware), and
        // the branch's advisory stock snapshot (any authenticated user)
        Route::post('sync/orders', [SyncController::class, 'orders'])->name('sync.orders');
        Route::get('sync/stock', [SyncController::class, 'stock'])->name('sync.stock');

        // Print configuration (any authenticated user): the branch, its receipt settings and
        // its printers with their category routes, cached by the device for offline printing
        Route::get('print-config', [PrintConfigController::class, 'show'])->name('print-config');

        // Print jobs of the web terminals (Web POS & Print Bridge → D; any authenticated user,
        // branch-scoped; creating needs a token bound to a device). Idempotent by the job's ulid.
        Route::controller(PrintJobController::class)
            ->prefix('print-jobs')
            ->name('print-jobs.')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->name('store');
                Route::post('{ulid}/retry', 'retry')->whereUlid('ulid')->name('retry');
            });

        // Dine-in Tables & Tabs (sale.create, via TabPolicy; 409 while dine-in is off in the
        // branch settings). Tab mutations are idempotent; `{ulid}` resolves within the caller's
        // branch only (other branches → 404).
        Route::get('tables', [TableController::class, 'index'])->name('tables.index');

        Route::controller(TabController::class)
            ->prefix('tabs')
            ->name('tabs.')
            ->whereUlid('ulid')
            ->group(function () {
                Route::post('/', 'store')->middleware('idempotent')->name('store');
                Route::get('{ulid}', 'show')->name('show');
                Route::patch('{ulid}', 'update')->middleware('idempotent')->name('update');
                Route::post('{ulid}/rounds', 'rounds')->middleware('idempotent')->name('rounds');
                Route::post('{ulid}/items/{id}/cancel', 'cancelItem')->middleware('idempotent')->whereNumber('id')->name('items.cancel');
                Route::post('{ulid}/settle', 'settle')->middleware('idempotent')->name('settle');
                Route::post('{ulid}/close', 'close')->middleware('idempotent')->name('close');
                Route::post('{ulid}/transfer', 'transfer')->middleware('idempotent')->name('transfer');
                Route::post('{ulid}/merge', 'merge')->middleware('idempotent')->name('merge');
            });

        // Customers (read: any authenticated user; write: sale.create; delete: customer.manage, via CustomerPolicy)
        Route::controller(CustomerController::class)
            ->prefix('customers')
            ->name('customers.')
            ->whereNumber('customer')
            ->group(function () {
                Route::get('/', 'index')->name('index');
                Route::post('/', 'store')->name('store');
                Route::get('{customer}', 'show')->name('show');
                Route::patch('{customer}', 'update')->name('update');
                Route::delete('{customer}', 'destroy')->name('destroy');
            });

        Route::prefix('admin')->name('admin.')->group(function () {
            // Staff (permission user.manage + role hierarchy, via UserPolicy). `{user}` is
            // bound within the caller's branch only (AppServiceProvider): other branches → 404.
            Route::controller(UserController::class)
                ->prefix('users')
                ->name('users.')
                ->whereNumber('user')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::get('{user}', 'show')->name('show');
                    Route::patch('{user}', 'update')->name('update');
                    Route::delete('{user}', 'destroy')->name('destroy');
                    Route::post('{user}/password', 'resetPassword')->name('password');
                    Route::put('{user}/pin', 'setPin')->name('pin');
                });

            Route::get('roles', [RoleController::class, 'index'])->name('roles.index');

            // Catalogue management (permission product.manage, enforced by CategoryPolicy / ProductPolicy)
            Route::controller(AdminCategoryController::class)
                ->prefix('categories')
                ->name('categories.')
                ->whereNumber('category')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::get('{category}', 'show')->name('show');
                    Route::patch('{category}', 'update')->name('update');
                    Route::delete('{category}', 'destroy')->name('destroy');
                    Route::post('{category}/image', 'storeImage')->name('image.store');
                    Route::delete('{category}/image', 'destroyImage')->name('image.destroy');
                });

            Route::controller(AdminProductController::class)
                ->prefix('products')
                ->name('products.')
                ->whereNumber('product')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::get('{product}', 'show')->name('show');
                    Route::patch('{product}', 'update')->name('update');
                    Route::delete('{product}', 'destroy')->name('destroy');
                    Route::post('{product}/image', 'storeImage')->name('image.store');
                    Route::delete('{product}/image', 'destroyImage')->name('image.destroy');

                    // Recipes (Ingredients, Recipes & Purchasing → J; product.manage, via ProductPolicy)
                    Route::get('{product}/recipe', [RecipeController::class, 'show'])->name('recipe.show');
                    Route::put('{product}/recipe', [RecipeController::class, 'update'])->name('recipe.update');
                    Route::post('{product}/recipe/apply-cost', [RecipeController::class, 'applyCost'])->name('recipe.apply-cost');

                    // Stock adjustments (permission inventory.adjust, via ProductPolicy::adjustStock)
                    Route::post('{product}/stock-adjustments', [ProductStockController::class, 'store'])
                        ->middleware('idempotent')
                        ->name('stock.store');
                });

            // Suppliers (Ingredients, Recipes & Purchasing): managed with supplier.manage; read also
            // with any purchase permission (SupplierPolicy)
            Route::controller(SupplierController::class)
                ->prefix('suppliers')
                ->name('suppliers.')
                ->whereNumber('supplier')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::get('{supplier}', 'show')->name('show');
                    Route::patch('{supplier}', 'update')->name('update');
                    Route::delete('{supplier}', 'destroy')->name('destroy');
                });

            // Ingredients (Ingredients, Recipes & Purchasing): managed with product.manage; read also
            // with inventory.adjust, any purchase permission or report.view (IngredientPolicy)
            Route::controller(IngredientController::class)
                ->prefix('ingredients')
                ->name('ingredients.')
                ->whereNumber('ingredient')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::get('{ingredient}', 'show')->name('show');
                    Route::patch('{ingredient}', 'update')->name('update');
                    Route::delete('{ingredient}', 'destroy')->name('destroy');
                    Route::post('{ingredient}/image', 'storeImage')->name('image.store');
                    Route::delete('{ingredient}/image', 'destroyImage')->name('image.destroy');

                    // Stock adjustments (permission inventory.adjust, via IngredientPolicy::adjustStock)
                    Route::post('{ingredient}/stock-adjustments', [IngredientStockController::class, 'store'])
                        ->middleware('idempotent')
                        ->name('stock.store');

                    // Set cost (D1; permission inventory.adjust, via IngredientPolicy::setCost)
                    Route::post('{ingredient}/cost', [IngredientCostController::class, 'store'])
                        ->middleware('idempotent')
                        ->name('cost.store');
                });

            // Printers and receipt settings (permission settings.manage, via PrinterPolicy / SettingPolicy).
            // `{printer}` is bound within the caller's branch only (AppServiceProvider): other branches → 404.
            Route::controller(PrinterController::class)
                ->prefix('printers')
                ->name('printers.')
                ->whereNumber('printer')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::get('{printer}', 'show')->name('show');
                    Route::patch('{printer}', 'update')->name('update');
                    Route::delete('{printer}', 'destroy')->name('destroy');
                });

            // Dine-in tables (Dine-in Tables & Tabs → B; permission settings.manage, via
            // DiningTablePolicy). `{diningTable}` is bound within the caller's branch only.
            Route::controller(DiningTableController::class)
                ->prefix('tables')
                ->name('tables.')
                ->whereNumber('diningTable')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::post('/', 'store')->name('store');
                    Route::patch('{diningTable}', 'update')->name('update');
                    Route::delete('{diningTable}', 'destroy')->name('destroy');
                });

            Route::controller(SettingsController::class)
                ->prefix('settings')
                ->name('settings.')
                ->group(function () {
                    Route::get('/', 'show')->name('show');
                    Route::patch('/', 'update')->name('update');
                });

            // Devices (Hardening & Pilot → C; permission system.manage, via DevicePolicy). `{device}`
            // is bound within the caller's branch only (AppServiceProvider): other branches → 404.
            Route::controller(AdminDeviceController::class)
                ->prefix('devices')
                ->name('devices.')
                ->whereNumber('device')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::get('{device}', 'show')->name('show');
                    Route::patch('{device}', 'update')->name('update');
                    Route::post('{device}/retire', 'retire')->name('retire');
                    Route::post('{device}/restore', 'restore')->name('restore');
                });

            // The error log (Hardening & Pilot → B; permission system.manage, via ErrorGroupPolicy).
            // `{errorGroup}` resolves only to a group the caller can see (AppServiceProvider).
            Route::controller(ErrorLogController::class)
                ->prefix('error-log')
                ->name('error-log.')
                ->whereNumber('errorGroup')
                ->group(function () {
                    Route::get('/', 'index')->name('index');
                    Route::get('{errorGroup}', 'show')->name('show');
                    Route::post('{errorGroup}/resolve', 'resolve')->name('resolve');
                    Route::post('{errorGroup}/reopen', 'reopen')->name('reopen');
                });
        });
    });
});
