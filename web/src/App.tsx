/**
 * Routes (React Router, `basename="/pos"`; Web POS §A). Pages only: the
 * logic lives in hooks and services. Module routes are guarded with the same
 * `@/constants/modules` list the sidebar reads.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";

import { EmptyState, LoadingRows } from "@/components/common/ListStates";
import { AppLayout } from "@/components/shell/AppLayout";
import {
    HomeRedirect,
    NavigationBridge,
    RequireAuth,
    RequireModule,
    SessionGate,
} from "@/components/shell/Guards";
import { Toaster } from "@/components/ui/sonner";
import type { ModuleKey } from "@/constants/modules";
import { LoginPage } from "@/routes/LoginPage";
import { SellPage } from "@/routes/SellPage";
import { queryClient } from "@/services/queryClient";

// The back-office pages load on demand; the cashier's Sell screen ships in the main bundle.
const OrdersPage = lazy(() =>
    import("@/routes/OrdersPage").then((module) => ({
        default: module.OrdersPage,
    })),
);
const ShiftsPage = lazy(() =>
    import("@/routes/ShiftsPage").then((module) => ({
        default: module.ShiftsPage,
    })),
);
const PrintersPage = lazy(() =>
    import("@/routes/PrintersPage").then((module) => ({
        default: module.PrintersPage,
    })),
);
const PrinterFormPage = lazy(() =>
    import("@/routes/PrinterFormPage").then((module) => ({
        default: module.PrinterFormPage,
    })),
);
const ReceiptSettingsPage = lazy(() =>
    import("@/routes/ReceiptSettingsPage").then((module) => ({
        default: module.ReceiptSettingsPage,
    })),
);
const CategoriesPage = lazy(() =>
    import("@/routes/CategoriesPage").then((module) => ({
        default: module.CategoriesPage,
    })),
);
const CategoryFormPage = lazy(() =>
    import("@/routes/CategoryFormPage").then((module) => ({
        default: module.CategoryFormPage,
    })),
);
const ProductsPage = lazy(() =>
    import("@/routes/ProductsPage").then((module) => ({
        default: module.ProductsPage,
    })),
);
const ProductFormPage = lazy(() =>
    import("@/routes/ProductFormPage").then((module) => ({
        default: module.ProductFormPage,
    })),
);
const StaffPage = lazy(() =>
    import("@/routes/StaffPage").then((module) => ({
        default: module.StaffPage,
    })),
);
const StaffFormPage = lazy(() =>
    import("@/routes/StaffFormPage").then((module) => ({
        default: module.StaffFormPage,
    })),
);
const RolesPage = lazy(() =>
    import("@/routes/RolesPage").then((module) => ({
        default: module.RolesPage,
    })),
);
const CustomersPage = lazy(() =>
    import("@/routes/CustomersPage").then((module) => ({
        default: module.CustomersPage,
    })),
);
const CustomerFormPage = lazy(() =>
    import("@/routes/CustomerFormPage").then((module) => ({
        default: module.CustomerFormPage,
    })),
);
const InventoryPage = lazy(() =>
    import("@/routes/InventoryPage").then((module) => ({
        default: module.InventoryPage,
    })),
);
const InventoryDetailPage = lazy(() =>
    import("@/routes/InventoryDetailPage").then((module) => ({
        default: module.InventoryDetailPage,
    })),
);
const IngredientStockPage = lazy(() =>
    import("@/routes/IngredientStockPage").then((module) => ({
        default: module.IngredientStockPage,
    })),
);
const IngredientStockDetailPage = lazy(() =>
    import("@/routes/IngredientStockDetailPage").then((module) => ({
        default: module.IngredientStockDetailPage,
    })),
);
const IngredientsPage = lazy(() =>
    import("@/routes/IngredientsPage").then((module) => ({
        default: module.IngredientsPage,
    })),
);
const IngredientFormPage = lazy(() =>
    import("@/routes/IngredientFormPage").then((module) => ({
        default: module.IngredientFormPage,
    })),
);
const UnitsPage = lazy(() =>
    import("@/routes/UnitsPage").then((module) => ({
        default: module.UnitsPage,
    })),
);
const SuppliersPage = lazy(() =>
    import("@/routes/SuppliersPage").then((module) => ({
        default: module.SuppliersPage,
    })),
);
const SupplierFormPage = lazy(() =>
    import("@/routes/SupplierFormPage").then((module) => ({
        default: module.SupplierFormPage,
    })),
);
const PurchaseRequestsPage = lazy(() =>
    import("@/routes/PurchaseRequestsPage").then((module) => ({
        default: module.PurchaseRequestsPage,
    })),
);
const PurchaseRequestFormPage = lazy(() =>
    import("@/routes/PurchaseRequestFormPage").then((module) => ({
        default: module.PurchaseRequestFormPage,
    })),
);
const PurchaseRequestDetailPage = lazy(() =>
    import("@/routes/PurchaseRequestDetailPage").then((module) => ({
        default: module.PurchaseRequestDetailPage,
    })),
);
const PurchaseOrdersPage = lazy(() =>
    import("@/routes/PurchaseOrdersPage").then((module) => ({
        default: module.PurchaseOrdersPage,
    })),
);
const PurchaseOrderDetailPage = lazy(() =>
    import("@/routes/PurchaseOrderDetailPage").then((module) => ({
        default: module.PurchaseOrderDetailPage,
    })),
);
// Purchase Request & Order PDF (v1.24): the print views, outside the app shell.
const PurchaseRequestPrintPage = lazy(() =>
    import("@/routes/PurchaseRequestPrintPage").then((module) => ({
        default: module.PurchaseRequestPrintPage,
    })),
);
const PurchaseOrderPrintPage = lazy(() =>
    import("@/routes/PurchaseOrderPrintPage").then((module) => ({
        default: module.PurchaseOrderPrintPage,
    })),
);
const ReceivePage = lazy(() =>
    import("@/routes/ReceivePage").then((module) => ({
        default: module.ReceivePage,
    })),
);
// W5: the dashboard and the reports carry Recharts, so they load in their own chunks.
const DashboardPage = lazy(() =>
    import("@/routes/DashboardPage").then((module) => ({
        default: module.DashboardPage,
    })),
);
const ReportsPage = lazy(() =>
    import("@/routes/ReportsPage").then((module) => ({
        default: module.ReportsPage,
    })),
);
// Hardening & Pilot: This terminal (everyone), Devices and the Error log (`system.manage`).
const TerminalPage = lazy(() =>
    import("@/routes/TerminalPage").then((module) => ({
        default: module.TerminalPage,
    })),
);
const DevicesPage = lazy(() =>
    import("@/routes/DevicesPage").then((module) => ({
        default: module.DevicesPage,
    })),
);
// Dine-in Tables & Tabs (v1.26): Admin → Tables.
const TablesPage = lazy(() =>
    import("@/routes/TablesPage").then((module) => ({
        default: module.TablesPage,
    })),
);
const ErrorLogPage = lazy(() =>
    import("@/routes/ErrorLogPage").then((module) => ({
        default: module.ErrorLogPage,
    })),
);

function Lazy({ children }: { children: ReactNode }) {
    return <Suspense fallback={<LoadingRows rows={6} />}>{children}</Suspense>;
}

/** A lazily loaded back-office page behind its module's permission guard. */
function ModulePage({
    module,
    children,
}: {
    module: ModuleKey;
    children: ReactNode;
}) {
    return (
        <RequireModule module={module}>
            <Lazy>{children}</Lazy>
        </RequireModule>
    );
}

function NotFound() {
    return (
        <EmptyState
            title="Page not found"
            message="This page doesn't exist in the web POS. Use the menu on the left."
        />
    );
}

export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter basename="/pos">
                <NavigationBridge />
                <SessionGate>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        {/* v1.24 print views: signed in and behind the purchasing module, but without the sidebar. */}
                        <Route
                            element={
                                <RequireAuth>
                                    <Outlet />
                                </RequireAuth>
                            }
                        >
                            <Route
                                path="purchasing/requests/:ulid/print"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseRequestPrintPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/orders/:ulid/print"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseOrderPrintPage />
                                    </ModulePage>
                                }
                            />
                        </Route>
                        <Route
                            element={
                                <RequireAuth>
                                    <AppLayout />
                                </RequireAuth>
                            }
                        >
                            <Route index element={<HomeRedirect />} />
                            <Route
                                path="dashboard"
                                element={
                                    <ModulePage module="dashboard">
                                        <DashboardPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="reports"
                                element={
                                    <ModulePage module="reports">
                                        <ReportsPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="sell"
                                element={
                                    <RequireModule module="pos">
                                        <SellPage />
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="orders"
                                element={
                                    <RequireModule module="orders">
                                        <Lazy>
                                            <OrdersPage />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="orders/review"
                                element={
                                    <RequireModule module="review">
                                        <Lazy>
                                            <OrdersPage needsReview />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="shifts"
                                element={
                                    <RequireModule module="shifts">
                                        <Lazy>
                                            <ShiftsPage />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="printers"
                                element={
                                    <RequireModule module="printers">
                                        <Lazy>
                                            <PrintersPage />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="printers/new"
                                element={
                                    <RequireModule module="printers">
                                        <Lazy>
                                            <PrinterFormPage />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="printers/receipt-settings"
                                element={
                                    <RequireModule module="printers">
                                        <Lazy>
                                            <ReceiptSettingsPage />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="printers/:id"
                                element={
                                    <RequireModule module="printers">
                                        <Lazy>
                                            <PrinterFormPage />
                                        </Lazy>
                                    </RequireModule>
                                }
                            />
                            <Route
                                path="categories"
                                element={
                                    <ModulePage module="categories">
                                        <CategoriesPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="categories/new"
                                element={
                                    <ModulePage module="categories">
                                        <CategoryFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="categories/:id"
                                element={
                                    <ModulePage module="categories">
                                        <CategoryFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="products"
                                element={
                                    <ModulePage module="products">
                                        <ProductsPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="products/new"
                                element={
                                    <ModulePage module="products">
                                        <ProductFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="products/:id"
                                element={
                                    <ModulePage module="products">
                                        <ProductFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="staff"
                                element={
                                    <ModulePage module="staff">
                                        <StaffPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="staff/roles"
                                element={
                                    <ModulePage module="roles">
                                        <RolesPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="staff/new"
                                element={
                                    <ModulePage module="staff">
                                        <StaffFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="staff/:id"
                                element={
                                    <ModulePage module="staff">
                                        <StaffFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="customers"
                                element={
                                    <ModulePage module="customers">
                                        <CustomersPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="customers/new"
                                element={
                                    <ModulePage module="customers">
                                        <CustomerFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="customers/:id"
                                element={
                                    <ModulePage module="customers">
                                        <CustomerFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="inventory"
                                element={
                                    <ModulePage module="inventory">
                                        <InventoryPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="inventory/ingredients"
                                element={
                                    <ModulePage module="inventory">
                                        <IngredientStockPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="inventory/ingredients/:id"
                                element={
                                    <ModulePage module="inventory">
                                        <IngredientStockDetailPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="inventory/:productId"
                                element={
                                    <ModulePage module="inventory">
                                        <InventoryDetailPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="ingredients"
                                element={
                                    <ModulePage module="ingredients">
                                        <IngredientsPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="ingredients/units"
                                element={
                                    <ModulePage module="units">
                                        <UnitsPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="ingredients/new"
                                element={
                                    <ModulePage module="ingredients">
                                        <IngredientFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="ingredients/:id"
                                element={
                                    <ModulePage module="ingredients">
                                        <IngredientFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="suppliers"
                                element={
                                    <ModulePage module="suppliers">
                                        <SuppliersPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="suppliers/new"
                                element={
                                    <ModulePage module="suppliers">
                                        <SupplierFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="suppliers/:id"
                                element={
                                    <ModulePage module="suppliers">
                                        <SupplierFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing"
                                element={
                                    <Navigate
                                        to="/purchasing/requests"
                                        replace
                                    />
                                }
                            />
                            <Route
                                path="purchasing/requests"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseRequestsPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/requests/new"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseRequestFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/requests/:ulid"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseRequestDetailPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/requests/:ulid/edit"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseRequestFormPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/orders"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseOrdersPage
                                            key="orders"
                                            mode="orders"
                                        />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/orders/:ulid"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseOrderDetailPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/receiving"
                                element={
                                    <ModulePage module="purchasing">
                                        <PurchaseOrdersPage
                                            key="receiving"
                                            mode="receiving"
                                        />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="purchasing/receiving/:ulid"
                                element={
                                    <ModulePage module="purchasing">
                                        <ReceivePage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="tables"
                                element={
                                    <ModulePage module="tables">
                                        <TablesPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="device"
                                element={
                                    <ModulePage module="device">
                                        <TerminalPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="settings/devices"
                                element={
                                    <ModulePage module="devices">
                                        <DevicesPage />
                                    </ModulePage>
                                }
                            />
                            <Route
                                path="settings/error-log"
                                element={
                                    <ModulePage module="errorLog">
                                        <ErrorLogPage />
                                    </ModulePage>
                                }
                            />
                            <Route path="*" element={<NotFound />} />
                        </Route>
                    </Routes>
                </SessionGate>
            </BrowserRouter>
            <Toaster />
        </QueryClientProvider>
    );
}
