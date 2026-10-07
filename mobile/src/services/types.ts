/**
 * Request / response types mirroring docs/api-contract.md field-for-field.
 * Do not add fields the contract does not define.
 */

// ---------------------------------------------------------------------------
// Global conventions
// ---------------------------------------------------------------------------

/** ISO 8601 UTC date-time string, e.g. "2026-09-24T03:15:00Z". */
export type IsoDateTime = string;

/** Success envelope for a single resource. */
export type DataEnvelope<T> = {
  data: T;
};

/** Error body for every non-422 error status. */
export type ApiErrorBody = {
  message: string;
};

/** 422 body: Laravel's default validation shape. */
export type ValidationErrorBody = {
  message: string;
  errors: Record<string, string[]>;
};

// ---------------------------------------------------------------------------
// Feature: Auth & Access Control (Phase 0)
// ---------------------------------------------------------------------------

export type AuthUserRole = {
  id: number;
  /** Stable key: `owner`, `manager`, `cashier`. Never compare role ids. */
  slug: string;
  name: string;
  /** 0–100 */
  max_discount_percent: number;
  is_admin: boolean;
};

export type AuthUserBranch = {
  id: number;
  code: string;
  name: string;
  /** IANA zone, e.g. `Asia/Manila`. */
  timezone: string;
  /** `HH:MM`, local time. */
  day_start_time: string;
};

/**
 * Shared object returned by `login` (inside `data.user`) and by `me` (as `data`).
 * Revision 2 removed the device object; a user cached by an older build may
 * still carry one, which the app ignores.
 */
export type AuthUser = {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  last_login_at: IsoDateTime | null;
  role: AuthUserRole;
  branch: AuthUserBranch;
  /** Permission slugs, sorted A→Z, no duplicates. May be empty. UI hint only. */
  permissions: string[];
};

/** POST /api/v1/auth/login body. Revision 2: `email` + `password` only, no other fields. */
export type LoginRequest = {
  email: string;
  password: string;
};

/** POST /api/v1/auth/login 200 `data`. */
export type LoginResponse = {
  token: string;
  token_type: 'Bearer';
  expires_at: IsoDateTime;
  user: AuthUser;
};

/** GET /api/v1/auth/me 200 `data`. */
export type MeResponse = AuthUser;

// ---------------------------------------------------------------------------
// Global conventions: cursor pagination
// ---------------------------------------------------------------------------

/** `links` of a cursor-paginated list (Laravel default). The app does not read it. */
export type CursorLinks = {
  first: string | null;
  last: string | null;
  prev: string | null;
  next: string | null;
};

/** `meta` of a cursor-paginated list. The app reads `next_cursor` only. */
export type CursorMeta = {
  path: string;
  per_page: number;
  /** `null` on the last page. Pass back as `?cursor=`. */
  next_cursor: string | null;
  prev_cursor: string | null;
};

/** Cursor-paginated list envelope (Global Conventions → Success: paginated list). */
export type CursorPage<T> = {
  data: T[];
  links: CursorLinks;
  meta: CursorMeta;
};

/** Query params every cursor-paginated endpoint accepts. */
export type CursorParams = {
  /** 1–100. */
  per_page?: number;
  /** From `meta.next_cursor`. */
  cursor?: string;
};

/**
 * A file part for a `multipart/form-data` upload, in React Native's
 * `FormData.append(name, { uri, name, type })` shape.
 */
export type UploadFile = {
  /** Local file URI, e.g. `file:///…/image.jpg`. */
  uri: string;
  /** File name sent to the server, e.g. `product-7.jpg`. */
  name: string;
  /** MIME type: `image/jpeg`, `image/png` or `image/webp`. */
  type: string;
};

// ---------------------------------------------------------------------------
// Feature: Catalogue: Categories & Products (Phase 1a)
// ---------------------------------------------------------------------------

/** Shared object `Category`. */
export type Category = {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  /** Read endpoint: available products only. Admin endpoints: all non-deleted products. */
  products_count: number;
  /** Absolute URL the app can load directly. */
  image_url: string | null;
  image_path: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/** `Product.category`. */
export type ProductCategory = {
  id: number;
  name: string;
};

/** Shared object `Product`. */
export type Product = {
  id: number;
  category: ProductCategory;
  sku: string | null;
  name: string;
  description: string | null;
  /** Selling price in centavos, VAT-inclusive. */
  price_cents: number;
  /** Admin endpoints only: the key is absent from `GET /api/v1/products`. */
  cost_cents?: number;
  is_vatable: boolean;
  is_available: boolean;
  /** `stock_mode == own` (§J keeps it in every response, so older readers keep working). */
  track_stock: boolean;
  /**
   * §J: how sales deplete stock. On every `Product` (admin and `GET /products`,
   * Q-031). Optional here only so a pre-§J cached copy still reads: readers go
   * through `stockModeOf()`, which falls back to `track_stock`.
   */
  stock_mode?: StockMode;
  sort_order: number;
  /** Absolute URL the app can load directly. */
  image_url: string | null;
  image_path: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/**
 * A `Product` from an admin endpoint, where `cost_cents` is always present.
 * Phase 3 adds `stock_qty`: the caller's branch quantity on hand when
 * `track_stock` is true (`0` if never stocked), otherwise `null`. Admin
 * endpoints only; the read endpoint and the catalogue sync don't send it.
 */
export type AdminProduct = Product & { cost_cents: number; stock_qty: number | null; stock_mode: StockMode };

/**
 * §J product stock modes: `own` (its own stock, as `track_stock`), `recipe`
 * (sales deplete its recipe's components), `none` (not tracked).
 */
export type StockMode = 'own' | 'recipe' | 'none';

/** GET /api/v1/categories query. */
export type CategoryListParams = CursorParams;

/** GET /api/v1/products query. */
export type ProductListParams = CursorParams & {
  category_id?: number;
  /** Max 100. Contains on `name` or `sku`. */
  search?: string;
};

/** GET /api/v1/admin/categories query. */
export type AdminCategoryListParams = CursorParams & {
  /** Max 100. Contains on `name`. */
  search?: string;
  is_active?: boolean;
};

/** GET /api/v1/admin/products query. */
export type AdminProductListParams = CursorParams & {
  /** Max 100. Contains on `name` or `sku`. */
  search?: string;
  category_id?: number;
  is_available?: boolean;
};

/** POST /api/v1/admin/categories body. */
export type CategoryCreateRequest = {
  /** Max 80, unique (case-insensitive). */
  name: string;
  /** Max 255. */
  description?: string | null;
  /** 0–65535, default 0. */
  sort_order?: number;
  /** Default `true`. */
  is_active?: boolean;
};

/** PATCH /api/v1/admin/categories/{id} body: partial, only the fields sent change. */
export type CategoryUpdateRequest = Partial<CategoryCreateRequest>;

/** POST /api/v1/admin/products body. Money fields are JSON integers (centavos). */
export type ProductCreateRequest = {
  /** A non-deleted category (it may be inactive). */
  category_id: number;
  /** Max 120. */
  name: string;
  /** Max 50, alpha_dash, unique (case-insensitive) when present. */
  sku?: string | null;
  /** Max 500. */
  description?: string | null;
  /** 0–100000000. */
  price_cents: number;
  /** 0–100000000, default 0. */
  cost_cents?: number;
  /** Default `true`. */
  is_vatable?: boolean;
  /** Default `true`. */
  is_available?: boolean;
  /** Default `false`. Superseded by `stock_mode` (§J): the app no longer sends it. */
  track_stock?: boolean;
  /**
   * §J: `own` | `recipe` | `none`. Leaving `own` while the product's stock is
   * above 0 → `409 "Use up or write off the stock first."`.
   */
  stock_mode?: StockMode;
  /** 0–65535, default 0. */
  sort_order?: number;
};

/** PATCH /api/v1/admin/products/{id} body: partial, only the fields sent change. */
export type ProductUpdateRequest = Partial<ProductCreateRequest>;

// ---------------------------------------------------------------------------
// Feature: Staff & Customers (Phase 1b): staff
// ---------------------------------------------------------------------------

/** `StaffUser.role` (as in the Phase 0 list item). */
export type StaffUserRole = {
  id: number;
  /** Stable key: `owner`, `manager`, `cashier`. */
  slug: string;
  name: string;
};

/** Shared object `StaffUser`: every staff endpoint, including `GET /api/v1/admin/users`. */
export type StaffUser = {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  /** Whether a PIN is set. The PIN itself is never returned. */
  has_pin: boolean;
  /**
   * Whether the **caller** may edit, reset, deactivate or delete this user
   * (role hierarchy). `true` for the caller's own record, though the
   * self-protection 409s still apply. A UI hint: the server enforces.
   */
  can_manage: boolean;
  last_login_at: IsoDateTime | null;
  role: StaffUserRole;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/** `GET /api/v1/admin/roles` item. */
export type Role = {
  id: number;
  slug: string;
  name: string;
  is_admin: boolean;
  /** 0–100 */
  max_discount_percent: number;
  /** Permission slugs, sorted A→Z. */
  permissions: string[];
  /** Whether the **caller** may assign this role. */
  assignable: boolean;
};

/** GET /api/v1/admin/users query. */
export type StaffListParams = CursorParams & {
  /** Max 100. Contains on `name` or `email`. */
  search?: string;
  role_id?: number;
  is_active?: boolean;
};

/** GET /api/v1/admin/roles query (`per_page` default 100). */
export type RoleListParams = CursorParams;

/** POST /api/v1/admin/users body. */
export type StaffCreateRequest = {
  /** Max 100. */
  name: string;
  /** Max 255, unique among non-deleted users (case-insensitive). */
  email: string;
  /** Min 10, mixed case, a number, max 255. */
  password: string;
  /** Must be assignable by the caller. */
  role_id: number;
  /** Default `true`. */
  is_active?: boolean;
  /** 4–6 digits as a string, not trivial. Optional. */
  pin?: string | null;
};

/** PATCH /api/v1/admin/users/{id} body: partial; password and PIN are not accepted here. */
export type StaffUpdateRequest = {
  name?: string;
  email?: string;
  role_id?: number;
  is_active?: boolean;
};

/** POST /api/v1/admin/users/{id}/password body. */
export type StaffPasswordRequest = {
  password: string;
};

/** PUT /api/v1/admin/users/{id}/pin body: a 4–6 digit string, or `null` to remove the PIN. */
export type StaffPinRequest = {
  pin: string | null;
};

// ---------------------------------------------------------------------------
// Feature: Staff & Customers (Phase 1b): customers
// ---------------------------------------------------------------------------

/** Shared object `Customer` (global, not branch-scoped). */
export type Customer = {
  id: number;
  first_name: string;
  last_name: string | null;
  /** `first_name` + " " + `last_name`, trimmed. */
  full_name: string;
  /** Phone number as typed. */
  contact: string | null;
  /** Stored lowercased; not unique. */
  email: string | null;
  notes: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

/** GET /api/v1/customers query. */
export type CustomerListParams = CursorParams & {
  /** Max 100. Contains on first/last/full name, email and contact (digits only). */
  search?: string;
};

/** POST /api/v1/customers body. */
export type CustomerCreateRequest = {
  /** Max 60. */
  first_name: string;
  /** Max 60. */
  last_name?: string | null;
  /** Max 30; digits, spaces, `+ ( ) -`. */
  contact?: string | null;
  /** Max 255. */
  email?: string | null;
  /** Max 500. */
  notes?: string | null;
};

/** PATCH /api/v1/customers/{id} body: partial (`first_name` is not nullable). */
export type CustomerUpdateRequest = Partial<CustomerCreateRequest>;

// ---------------------------------------------------------------------------
// Feature: Dashboard (Phase 1c)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` label of a business day (branch timezone, day starting at `day_start_time`). */
export type BusinessDate = string;

/** An integer percentage in basis points: `5500` = 55.00%. Never a float. */
export type BasisPoints = number;

/** `catalog.low_margin_products[]`: margin below the threshold, lowest first, max 5. */
export type DashboardLowMarginProduct = {
  id: number;
  name: string;
  category_name: string;
  price_cents: number;
  cost_cents: number;
  margin_bps: BasisPoints;
};

/** `catalog.by_category[]`: every non-deleted category, in menu order. */
export type DashboardCategoryStats = {
  category_id: number;
  name: string;
  is_active: boolean;
  products_total: number;
  products_available: number;
  /** `null` when no product in the category qualifies (price or cost is 0). */
  average_margin_bps: BasisPoints | null;
};

/** Section `catalog` (permission `report.view`, global). */
export type DashboardCatalog = {
  products_total: number;
  products_available: number;
  products_unavailable: number;
  products_without_image: number;
  products_tracking_stock: number;
  products_without_cost: number;
  categories_total: number;
  categories_active: number;
  categories_empty: number;
  /** `null` when no product qualifies. */
  average_margin_bps: BasisPoints | null;
  /** Fixed 3000 (30%) for now. */
  low_margin_threshold_bps: BasisPoints;
  low_margin_products: DashboardLowMarginProduct[];
  by_category: DashboardCategoryStats[];
};

/** `staff.by_role[]`: every role (count 0 included), ordered by role `id`. */
export type DashboardRoleCount = {
  role_id: number;
  slug: string;
  name: string;
  count: number;
};

/** `staff.recent_logins[]`: the 5 latest logins, newest first. */
export type DashboardRecentLogin = {
  user_id: number;
  name: string;
  role_name: string;
  last_login_at: IsoDateTime;
};

/** Section `staff` (permission `user.manage`, caller's branch). */
export type DashboardStaff = {
  total: number;
  active: number;
  inactive: number;
  without_pin: number;
  never_logged_in: number;
  by_role: DashboardRoleCount[];
  recent_logins: DashboardRecentLogin[];
};

/** Section `customers` (any authenticated user, global). */
export type DashboardCustomers = {
  total: number;
  new_last_7_days: number;
  new_last_30_days: number;
};

/** One business-day bucket. */
export type DashboardDayCount = {
  date: BusinessDate;
  count: number;
};

/** `activity.recent_changes[]`: the 8 latest non-`auth.*` audit entries, newest first. */
export type DashboardRecentChange = {
  id: number;
  action: string;
  /** Short human sentence built server-side. */
  summary: string;
  actor_name: string;
  created_at: IsoDateTime;
};

/** Section `activity` (permission `report.view`, caller's branch). */
export type DashboardActivity = {
  /** Exactly 7 entries: the last 7 business days including today, oldest first. */
  logins_by_day: DashboardDayCount[];
  /** Exactly 7 entries, like `logins_by_day`. */
  changes_by_day: DashboardDayCount[];
  recent_changes: DashboardRecentChange[];
};

export type InsightSeverity = 'critical' | 'warning' | 'info';

/** App destination key of an insight's action. */
export type InsightAction =
  | 'menu.products'
  | 'menu.categories'
  | 'staff'
  | 'customers'
  | 'orders.review'
  | 'inventory.alerts'
  /** Ingredients, Recipes & Purchasing: `ingredients_out` / `ingredients_low`. */
  | 'inventory.ingredients.alerts'
  /** Q-029: the purchasing insights' action keys. */
  | 'purchasing.requests.pending'
  | 'purchasing.orders.pending'
  | 'purchasing.orders.to_receive';

/** `insights[]`: built only from sections the caller can see; ordered critical → warning → info, then `key`. */
export type Insight = {
  /** Stable id, e.g. `products_without_image`. */
  key: string;
  severity: InsightSeverity;
  /** Short, with the count. */
  title: string;
  /** One sentence of advice. */
  message: string;
  count: number;
  action: InsightAction | null;
};

/** `sales.by_payment_method[]`: always both methods, `cash` then `gcash`. */
export type DashboardPaymentMethodTotal = {
  method: PaymentMethod;
  /** Orders with at least one payment of this method. */
  orders_count: number;
  /** Σ stored `amount_cents` (net of change). */
  amount_cents: number;
};

/** `sales.last_7_days[]`: exactly 7 business days including today, oldest first, 0-filled. */
export type DashboardSalesDay = {
  date: BusinessDate;
  orders_count: number;
  net_sales_cents: number;
};

/** `sales.top_products[]`: today, max 5, by `qty` desc, then `net_sales_cents` desc, then `name`. */
export type DashboardTopProduct = {
  product_id: number;
  /** The most recent line snapshot of the name. */
  name: string;
  qty: number;
  /** Σ `line_total_cents`. */
  net_sales_cents: number;
};

/**
 * Section `sales` (permission `report.view`, caller's branch, today's
 * business day, orders that are not `voided`, Phase 7). With no sales today every figure is 0
 * and the lists keep their fixed shapes.
 */
export type DashboardSales = {
  business_date: BusinessDate;
  orders_count: number;
  /** Σ `qty`. */
  items_sold: number;
  /** Σ `subtotal_cents`. */
  gross_sales_cents: number;
  /** Σ `discount_cents`. */
  discounts_cents: number;
  /** Σ `total_cents`. */
  net_sales_cents: number;
  vat_amount_cents: number;
  /** `rhu(net_sales_cents, orders_count)`, or 0 with no orders. */
  average_order_cents: number;
  by_payment_method: DashboardPaymentMethodTotal[];
  last_7_days: DashboardSalesDay[];
  top_products: DashboardTopProduct[];
  /** Voids & Refunds (Phase 7): today's voided orders (on the order's business day). */
  voids_count: number;
  /** Phase 7: Σ `amount_cents` of today's refunds (on the refund's business day). */
  refunds_cents: number;
  /** Phase 7: `net_sales_cents − refunds_cents`. */
  net_after_refunds_cents: number;
} & ScPwdSalesFigures;

/**
 * GET /api/v1/dashboard → `data`. A section the caller may not see is `null`
 * (the key is always present). `sales` (Phase 3) needs `report.view`.
 */
export type Dashboard = {
  generated_at: IsoDateTime;
  business_date: BusinessDate;
  catalog: DashboardCatalog | null;
  staff: DashboardStaff | null;
  customers: DashboardCustomers | null;
  activity: DashboardActivity | null;
  sales: DashboardSales | null;
  insights: Insight[];
};

// ---------------------------------------------------------------------------
// Feature: Catalogue Sync (Phase 2)
// ---------------------------------------------------------------------------

/** GET /api/v1/sync/catalogue query. */
export type CatalogueSyncParams = {
  /** Opaque, `max:1000`. Omit for a full baseline; otherwise the previous `meta.next_cursor`, unchanged. */
  cursor?: string;
  /** 1–500, default 500: max rows **per entity** per page. */
  limit?: number;
};

/** `data.categories[]`. Inactive categories are included (the device hides them). No `products_count`, no `created_at`. */
export type SyncCategory = {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  /** Absolute URL. */
  image_url: string | null;
  /** Changes whenever the image changes. */
  image_path: string | null;
  updated_at: IsoDateTime;
};

/** `data.products[]`. Unavailable products are included. `cost_cents` is never sent. */
export type SyncProduct = {
  id: number;
  /** Only the id: there is no embedded category. */
  category_id: number;
  sku: string | null;
  name: string;
  description: string | null;
  /** VAT-inclusive selling price in centavos. */
  price_cents: number;
  is_vatable: boolean;
  is_available: boolean;
  track_stock: boolean;
  sort_order: number;
  /** Absolute URL. */
  image_url: string | null;
  image_path: string | null;
  updated_at: IsoDateTime;
};

/** `data.deleted`: ids sorted ascending. Both keys always present (may be empty; always empty in a baseline). */
export type SyncDeleted = {
  categories: number[];
  products: number[];
};

/** `meta` of a catalogue sync page. */
export type CatalogueSyncMeta = {
  /** `true` when the run started without a cursor (a baseline); the same on every page of the run. */
  full: boolean;
  /** `true`: call again at once with `next_cursor`. */
  has_more: boolean;
  /** Always present, including on the last page. */
  next_cursor: string;
  /** Server clock at response time: "Synced at …". */
  server_time: IsoDateTime;
};

/** GET /api/v1/sync/catalogue 200 body. */
export type CatalogueSyncResponse = {
  data: {
    categories: SyncCategory[];
    products: SyncProduct[];
    deleted: SyncDeleted;
  };
  meta: CatalogueSyncMeta;
};

// ---------------------------------------------------------------------------
// Feature: Core Sale (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Discount types in Phase 3. `senior_citizen` and `pwd` stay invalid as a
 * discount `type`: SC/PWD only goes through `sc_pwd` (Senior Citizen / PWD Discount).
 */
export type DiscountType = 'promo' | 'employee' | 'manual';

/** `percent`: `value` in basis points (1–10000). `amount`: `value` in centavos (1–1000000000). */
export type DiscountKind = 'percent' | 'amount';

/** A line or order discount, as sent (Discount rules). */
export type SaleDiscount = {
  type: DiscountType;
  kind: DiscountKind;
  value: number;
};

export type PaymentMethod = 'cash' | 'gcash';

/** POST /api/v1/orders → `items[]`. The same product may appear on several lines. */
export type OrderItemRequest = {
  product_id: number;
  /** 1–999, whole units. */
  qty: number;
  /** Line discount. */
  discount: SaleDiscount | null;
  /** Max 120. For the kitchen. */
  notes: string | null;
  /**
   * Senior Citizen / PWD Discount: marks the lines the SC/PWD consumes
   * (`boolean`, default `false`). `items` mode: at least one line `true`;
   * `headcount` mode and no `sc_pwd`: always `false`.
   */
  sc_pwd: boolean;
};

// ---------------------------------------------------------------------------
// Feature: Senior Citizen / PWD Discount
// ---------------------------------------------------------------------------

/** `items`: the cashier ticks the lines the SC/PWD consumes. `headcount`: a shared meal (`bill ÷ diners × persons`). */
export type ScPwdMode = 'items' | 'headcount';

export type ScPwdPersonType = 'senior_citizen' | 'pwd';

/** `sc_pwd.persons[]`: one entry per SC/PWD. */
export type ScPwdPerson = {
  type: ScPwdPersonType;
  /** The OSCA or PWD ID number: required, max 30, `^[A-Za-z0-9/ -]+$`, distinct within the order. */
  id_no: string;
};

/** `sc_pwd` on `POST /orders` and `OfflineOrder` (`null` or omitted: no SC/PWD). */
export type ScPwdRequest = {
  mode: ScPwdMode;
  /** 1–10 persons. */
  persons: ScPwdPerson[];
  /** `headcount`: the number of people sharing the bill (persons count–100). `items`: must be `null`. */
  diners: number | null;
  /** Whether the eligible part is VAT-exempt (pricing step B). The app's default is `false`. */
  vat_exempt: boolean;
};

/** `Order.sc_pwd` (and the offline printable order): the request plus `R` and `S`. */
export type OrderScPwd = ScPwdRequest & {
  /** `R`: the VAT removed (0 unless `vat_exempt`). */
  vat_relief_cents: number;
  /** `S`: the SC/PWD discount (20%). */
  discount_cents: number;
};

/**
 * Senior Citizen / PWD Discount → Reports: on `ShiftReport`, the sales
 * report `totals` and the dashboard `sales`. Non-voided orders, by the same
 * scope rules as the other sales figures.
 */
export type ScPwdSalesFigures = {
  sc_pwd_orders_count: number;
  /** Σ `R` (the VAT removed). */
  sc_pwd_vat_relief_cents: number;
  /** Σ `S` (the 20% discount). */
  sc_pwd_discount_cents: number;
};

/** POST /api/v1/orders → `payments[]`: max 5, at most one `cash`. */
export type OrderPaymentRequest = {
  method: PaymentMethod;
  /** Cash: the amount handed over (tendered). GCash: the amount paid. 1–1000000000. */
  amount_cents: number;
  /** GCash: required, max 64, `[A-Za-z0-9-]`. Cash: `null`. */
  reference_no: string | null;
};

/** A manager's approval of the discount, sent in the same request. */
export type DiscountAuthorization = {
  user_id: number;
  /** 4–6 digits. Never stored. */
  pin: string;
};

/** POST /api/v1/orders body (Idempotent: `Idempotency-Key` = `ulid`). */
export type OrderCreateRequest = {
  /** Client-generated ULID (uppercase Crockford base32). */
  ulid: string;
  customer_id: number | null;
  /** Max 255. */
  notes: string | null;
  /**
   * Table Number (Core Sale revision 2): optional, max 10, `^[A-Za-z0-9 -]+$`;
   * trimmed, and an empty value is `null`. Part of the idempotency body.
   */
  table_no: string | null;
  /** 1–100 lines. */
  items: OrderItemRequest[];
  /** Order discount. */
  discount: SaleDiscount | null;
  /** Empty only when the total is 0. */
  payments: OrderPaymentRequest[];
  /** The app's computed `total_cents` (the checksum). */
  client_total_cents: number;
  discount_authorization: DiscountAuthorization | null;
  /**
   * Shifts & Reporting (Phase 6): the tablet's open shift (`required`, ULID).
   * An online sale into a shift the server knows is closed returns `422` on
   * `shift_ulid` (`This shift is closed. Open a new shift.`).
   */
  shift_ulid: string;
  /** Senior Citizen / PWD Discount: `null` means no SC/PWD. It never needs approval. */
  sc_pwd: ScPwdRequest | null;
};

/** `{ id, name }` of a user: an order's cashier or approver, or a stock movement's author. */
export type UserRef = {
  id: number;
  name: string;
};

/** `Order.customer`: the current customer record (soft-deleted ones included). */
export type OrderCustomer = {
  id: number;
  full_name: string;
};

/** `Order.order_discount`: the order discount as sent, plus `amount_cents` = D. */
export type OrderDiscount = SaleDiscount & {
  amount_cents: number;
};

/**
 * Voids & Refunds (Phase 7): `completed → voided` (void); `completed |
 * partially_refunded → partially_refunded | refunded` (refund). `refunded` =
 * every line's full quantity has been refunded.
 */
export type OrderStatus = 'completed' | 'voided' | 'refunded' | 'partially_refunded';

/** Offline Sales (Phase 5): how the order reached the server. */
export type OrderSource = 'online' | 'offline';

/**
 * Offline Sales (Phase 5): why a synced offline sale was flagged, in the
 * contract's order. `review_reasons` is `string[]` in the contract, so a
 * reason this build doesn't know is shown as it is.
 */
export type ReviewReason =
  | 'price_changed'
  | 'oversold'
  | 'total_mismatch'
  | 'payment_short'
  | 'discount_over_limit'
  | 'clock_skew';

/** Offline Sales (Phase 5) → "Order changes": on every `Order` and `OrderSummary`. */
export type OrderSyncFields = {
  /** Shifts & Reporting (Phase 6): the shift the sale was rung into; `null` only for orders placed before Phase 6. */
  shift_ulid: string | null;
  /** The device number of an offline order (`T01-20260926-0005`); `null` for online ones. */
  order_no: string | null;
  source: OrderSource;
  needs_review: boolean;
  /** See `ReviewReason`; `[]` when there are none. */
  review_reasons: string[];
  reviewed_at: IsoDateTime | null;
  reviewed_by: UserRef | null;
  /** When an offline order reached the server; `null` for online ones. */
  synced_at: IsoDateTime | null;
};

/** `Order.items[]`, with the snapshots taken at sale time. `unit_cost_cents` is never returned. */
export type OrderItem = {
  id: number;
  product_id: number;
  product_name: string;
  /**
   * Printing (Phase 4): the product's category **at the time of sale** (a
   * snapshot). Kitchen routing and reprints use it, so a product moved or
   * deleted later still prints at the right station.
   */
  category_id: number;
  category_name: string;
  sku: string | null;
  qty: number;
  unit_price_cents: number;
  gross_cents: number;
  is_vatable: boolean;
  /** As sent. */
  discount: SaleDiscount | null;
  line_discount_cents: number;
  order_discount_share_cents: number;
  line_total_cents: number;
  notes: string | null;
  /** Voids & Refunds (Phase 7): units of this line refunded so far (`0` when none). */
  refunded_qty: number;
  /** Phase 7: Σ of this line's refund amounts (`0` when none). */
  refunded_cents: number;
  /** Senior Citizen / PWD Discount: marked, or given any share in `headcount` mode. */
  sc_pwd: boolean;
  /** `E_i`: the line's eligible gross. */
  sc_pwd_eligible_cents: number;
  /** `R_i`: the line's share of the VAT removed. */
  sc_pwd_vat_relief_cents: number;
  /** `S_i`: the line's share of the SC/PWD discount. */
  sc_pwd_discount_cents: number;
};

/**
 * `Order.payments[]`, in the order sent. Cash: `tendered_cents` = the amount
 * sent, `amount_cents` = tendered − change. GCash: `tendered_cents` = null,
 * `change_cents` = 0.
 */
export type OrderPayment = {
  method: PaymentMethod;
  amount_cents: number;
  tendered_cents: number | null;
  change_cents: number;
  reference_no: string | null;
};

/** Shared object `Order` (POST /orders 201, GET /orders/{ulid}). */
export type Order = {
  /** The order's public id (routes use it). */
  ulid: string;
  invoice_no: string;
  queue_no: number;
  /** Table Number (Core Sale revision 2): a free label, e.g. "12" or "Patio 2"; `null` when not set. */
  table_no: string | null;
  business_date: BusinessDate;
  status: OrderStatus;
  placed_at: IsoDateTime;
  cashier: UserRef;
  /** The discount approver, when approval was needed. */
  authorized_by: UserRef | null;
  customer: OrderCustomer | null;
  notes: string | null;
  subtotal_cents: number;
  line_discounts_cents: number;
  order_discount: OrderDiscount | null;
  discount_cents: number;
  total_cents: number;
  vatable_sales_cents: number;
  vat_amount_cents: number;
  vat_exempt_sales_cents: number;
  /** Σ GCash `amount_cents` + Σ cash `tendered_cents`. */
  tendered_cents: number;
  change_cents: number;
  client_total_cents: number;
  has_total_mismatch: boolean;
  items: OrderItem[];
  payments: OrderPayment[];
  /** Senior Citizen / PWD Discount: `null` without SC/PWD. `discount_cents` includes its `R + S`. */
  sc_pwd: OrderScPwd | null;
} & OrderSyncFields &
  OrderReversalFields;

/** `Refund.items[]`: in the order they were sent. */
export type RefundItem = {
  order_item_id: number;
  product_name: string;
  qty: number;
  amount_cents: number;
};

/** `Refund.payments[]`: cash first. GCash carries the reference of the transfer back to the customer. */
export type RefundPayment = {
  method: PaymentMethod;
  amount_cents: number;
  reference_no: string | null;
};

/** Shared object `Refund` (Voids & Refunds, Phase 7): one refund of an order, oldest first in `Order.refunds`. */
export type Refund = {
  ulid: string;
  /** The business day **of the refund**, not of the sale. */
  business_date: BusinessDate;
  refunded_at: IsoDateTime;
  /** The refunding tablet's shift. */
  shift_ulid: string;
  refunded_by: UserRef;
  /** `null` when the caller had `sale.refund`. */
  authorized_by: UserRef | null;
  reason: string;
  amount_cents: number;
  vatable_sales_cents: number;
  vat_amount_cents: number;
  vat_exempt_sales_cents: number;
  items: RefundItem[];
  payments: RefundPayment[];
};

/** Voids & Refunds (Phase 7) → "Order changes": on every `Order`. */
export type OrderReversalFields = {
  voided_at: IsoDateTime | null;
  /** The user who made the void request. */
  voided_by: UserRef | null;
  void_reason: string | null;
  /** The approver when a PIN approval was used; `null` when the caller had `sale.void`. */
  void_authorized_by: UserRef | null;
  /** `Σ refunds[].amount_cents`, `0` when none. */
  refunded_cents: number;
  /** Oldest first, `[]` when none. */
  refunds: Refund[];
};

/** A manager's PIN approval of a void or refund (the caller lacks `sale.void` / `sale.refund`). */
export type ReversalAuthorization = {
  user_id: number;
  /** 4–6 digits. Never stored. */
  pin: string;
};

/**
 * POST /api/v1/orders/{ulid}/void body. Idempotent: the `Idempotency-Key` is
 * a ULID made when the void dialog opens, kept until a 200.
 */
export type VoidOrderRequest = {
  /** Required, max 255. */
  reason: string;
  authorization: ReversalAuthorization | null;
};

/** POST /api/v1/orders/{ulid}/refunds → `items[]`: distinct lines of this order. */
export type RefundItemRequest = {
  order_item_id: number;
  /** ≥ 1, at most the line's remaining quantity. */
  qty: number;
};

/** POST /api/v1/orders/{ulid}/refunds → `payments[]`: at most one per method; empty only when the amount is 0. */
export type RefundPaymentRequest = {
  method: PaymentMethod;
  /** ≥ 1. */
  amount_cents: number;
  /** GCash: required, max 64, `[A-Za-z0-9-]`. Cash: `null`. */
  reference_no: string | null;
};

/** POST /api/v1/orders/{ulid}/refunds body (Idempotent: `Idempotency-Key` = `ulid`). */
export type RefundCreateRequest = {
  /** The refund's id, made when the refund screen opens. */
  ulid: string;
  /** The **refunding** tablet's open shift. */
  shift_ulid: string;
  /** Required, max 255. */
  reason: string;
  /** 1–100 lines. */
  items: RefundItemRequest[];
  payments: RefundPaymentRequest[];
  /** The app's computed amount (the checksum; exact, no ±1). */
  client_refund_cents: number;
  authorization: ReversalAuthorization | null;
};

/** GET /api/v1/orders item. */
export type OrderSummary = {
  ulid: string;
  invoice_no: string;
  queue_no: number;
  /** Table Number (Core Sale revision 2); `null` when not set. */
  table_no: string | null;
  business_date: BusinessDate;
  status: OrderStatus;
  placed_at: IsoDateTime;
  cashier: UserRef;
  customer: OrderCustomer | null;
  /** Σ `qty`. */
  items_count: number;
  total_cents: number;
  /** The distinct methods used, sorted A→Z. */
  payment_methods: PaymentMethod[];
  /** Voids & Refunds (Phase 7): `Σ refunds[].amount_cents`, `0` when none. */
  refunded_cents: number;
  /** Senior Citizen / PWD Discount: the sale has an SC/PWD discount. */
  has_sc_pwd: boolean;
} & OrderSyncFields;

/** GET /api/v1/orders query. Ordered by `placed_at` desc, then `id` desc. */
export type OrderListParams = CursorParams & {
  /** `YYYY-MM-DD`. */
  business_date?: BusinessDate;
  /** Without `report.view`, only the caller's own id is allowed (else 403). */
  cashier_id?: number;
  /** Max 30. Contains on `invoice_no`. */
  search?: string;
  /** Offline Sales (Phase 5): only the orders flagged for review (sent as `1`). */
  needs_review?: boolean;
  /** Voids & Refunds (Phase 7): `in:completed,voided,refunded,partially_refunded`. */
  status?: OrderStatus;
};

/** GET /api/v1/auth/pin-users item: active users in the caller's branch who have a PIN. */
export type PinUser = {
  id: number;
  name: string;
  role: {
    slug: string;
    name: string;
  };
  /** The user has `discount.override` (a UI hint). */
  can_approve_discounts: boolean;
  /** The user's role limit (a UI hint). */
  max_discount_percent: number;
  /** Voids & Refunds (Phase 7): the user has `sale.void` (a UI hint for the void approver picker). */
  can_approve_voids: boolean;
  /** Phase 7: the user has `sale.refund` (a UI hint for the refund approver picker). */
  can_approve_refunds: boolean;
};

/** GET /api/v1/auth/pin-users query (`per_page` default 100). */
export type PinUserListParams = CursorParams;

/** POST /api/v1/auth/pin body. */
export type PinLoginRequest = {
  user_id: number;
  /** 4–6 digits. */
  pin: string;
};

/** POST /api/v1/auth/pin 200 `data`: exactly the login response. */
export type PinLoginResponse = LoginResponse;

/**
 * `type` of a stock adjustment (Inventory, v1 completion). Optional in the
 * body; the server defaults it to `adjustment` (the Phase 3 behaviour).
 */
export type StockAdjustmentType = 'adjustment' | 'receipt' | 'count' | 'wastage';

/**
 * POST /api/v1/admin/products/{id}/stock-adjustments body (Idempotent:
 * `Idempotency-Key` = `ulid`). Per `type`:
 * - `adjustment` (or no `type`): exactly one of `qty_delta` (non-zero,
 *   −100000 to 100000) or `counted_qty` (0 to 100000); `reason` required.
 * - `receipt` (stock in): `qty_delta` ≥ 1; `reason` optional (nullable, max 255);
 *   optional `unit_cost_cents` (0–100000000, defaults to the product's cost).
 * - `count`: `counted_qty`; `reason` required.
 * - `wastage`: `qty_delta` ≤ −1; `reason` required.
 */
export type StockAdjustmentRequest =
  | { ulid: string; type?: 'adjustment'; qty_delta: number; reason: string }
  | { ulid: string; type?: 'adjustment'; counted_qty: number; reason: string }
  | { ulid: string; type: 'receipt'; qty_delta: number; reason: string | null; unit_cost_cents?: number }
  | { ulid: string; type: 'count'; counted_qty: number; reason: string }
  | { ulid: string; type: 'wastage'; qty_delta: number; reason: string };

/**
 * Stock movement types. Phase 7 adds `void` and `refund` (written by the
 * server only); Inventory (v1 completion) adds `receipt`, `count` and `wastage`.
 */
export type StockMovementType = 'sale' | 'adjustment' | 'opening' | 'void' | 'refund' | 'receipt' | 'count' | 'wastage';

/** POST /api/v1/admin/products/{id}/stock-adjustments 201 `data`. */
export type StockMovement = {
  ulid: string;
  product_id: number;
  type: StockMovementType;
  qty_delta: number;
  qty_before: number;
  qty_after: number;
  /** `null` only on a stock in (`receipt`) sent without a note. */
  reason: string | null;
  occurred_at: IsoDateTime;
  created_by: UserRef;
};

// ---------------------------------------------------------------------------
// Feature: Printing (Phase 4)
// ---------------------------------------------------------------------------

/** `cashier` prints receipts; `kitchen` and `bar` print tickets. */
export type PrinterRole = 'cashier' | 'kitchen' | 'bar';

/** 58 mm = 32 columns, 80 mm = 48 columns on the device. */
export type PaperWidthMm = 58 | 80;

/** Shared object `Printer` (caller's branch). */
export type Printer = {
  id: number;
  /** Unique per branch among non-deleted printers (case-insensitive). */
  name: string;
  role: PrinterRole;
  /** An IPv4 address or a hostname: no scheme, no port. */
  host: string;
  /** Usually 9100. */
  port: number;
  paper_width_mm: PaperWidthMm;
  /** A disabled printer receives no jobs. */
  is_enabled: boolean;
  /** Receives items from categories with no route. At most one per branch; never a cashier printer. */
  is_default_kitchen: boolean;
  /** Categories routed here, ascending. Always `[]` for cashier printers. */
  category_ids: number[];
  created_at: IsoDateTime;
  /** Also changes when the routes change. */
  updated_at: IsoDateTime;
};

/** GET /api/v1/admin/printers query (`per_page` 1–100, default 100). */
export type PrinterListParams = CursorParams;

/** POST /api/v1/admin/printers body. */
export type PrinterCreateRequest = {
  /** Max 40, unique per branch (case-insensitive). */
  name: string;
  role: PrinterRole;
  /** Max 253: an IPv4 address or hostname (letters, digits, hyphens, dots). */
  host: string;
  /** 1–65535, default 9100. */
  port?: number;
  /** Default 80. */
  paper_width_mm?: PaperWidthMm;
  /** Default `true`. */
  is_enabled?: boolean;
  /** Default `false`. Kitchen or bar printers only. */
  is_default_kitchen?: boolean;
  /** Default `[]`. Distinct, non-deleted categories; must be empty on a cashier printer. Replaces the routes. */
  category_ids?: number[];
};

/** PATCH /api/v1/admin/printers/{id} body: partial. */
export type PrinterUpdateRequest = Partial<PrinterCreateRequest>;

/** Shared object `BranchSettings` (the caller's branch, with defaults filled in). */
export type BranchSettings = {
  /** Up to 6 lines of up to 48 characters. */
  receipt_header_lines: string[];
  /** Up to 6 lines of up to 48 characters. */
  receipt_footer_lines: string[];
  auto_print_receipt: boolean;
  /** 1–3. */
  receipt_copies: number;
  print_kitchen_tickets: boolean;
  /** `null` until the settings are first saved. */
  updated_at: IsoDateTime | null;
};

/** PATCH /api/v1/admin/settings body: partial. */
export type BranchSettingsUpdateRequest = {
  receipt_header_lines?: string[];
  receipt_footer_lines?: string[];
  auto_print_receipt?: boolean;
  receipt_copies?: number;
  print_kitchen_tickets?: boolean;
};

/** `print-config.branch`. */
export type PrintConfigBranch = {
  id: number;
  name: string;
  /** IANA zone: receipts and tickets print times in it. */
  timezone: string;
};

/** GET /api/v1/print-config → `data`: everything the device needs to print. */
export type PrintConfig = {
  branch: PrintConfigBranch;
  settings: BranchSettings;
  /** Every non-deleted printer of the branch, disabled ones included, by `name` then `id`. */
  printers: Printer[];
  generated_at: IsoDateTime;
};

// ---------------------------------------------------------------------------
// Feature: Offline Sales (Phase 5)
// ---------------------------------------------------------------------------

/** POST /api/v1/devices/register body. */
export type DeviceRegisterRequest = {
  /** A ULID generated once per app install (SecureStore). */
  install_id: string;
  /** Max 60, e.g. the device model. */
  name: string;
  /** Max 20. */
  app_version: string | null;
};

/** POST /api/v1/devices/register 200 `data`. */
export type RegisteredDevice = {
  id: number;
  /** `T` + the id padded to 2 digits: `T01`, `T02`, … `T123`. */
  code: string;
  name: string;
};

/** `OfflineOrder.items[]`: the `POST /orders` item plus the price the device sold at. */
export type OfflineOrderItem = OrderItemRequest & {
  /** The snapshot, 0–100000000. */
  unit_price_cents: number;
};

/**
 * `OfflineOrder` (POST /api/v1/sync/orders → `orders[]`): the `POST /orders`
 * body **without** `discount_authorization`, plus `order_no`, `placed_at`,
 * `cashier_id` and `items[].unit_price_cents`.
 */
export type OfflineOrder = Omit<OrderCreateRequest, 'discount_authorization' | 'items'> & {
  items: OfflineOrderItem[];
  /** `^[A-Z0-9]{1,8}-\d{8}-\d{4,6}$`: `{device code}-{YYYYMMDD}-{daily sequence}`. */
  order_no: string;
  /** The device clock when the sale was confirmed. */
  placed_at: IsoDateTime;
  /** The user signed in on the device at sale time. */
  cashier_id: number;
};

/** POST /api/v1/sync/orders body: 1–50 orders. */
export type SyncOrdersRequest = {
  orders: OfflineOrder[];
};

export type SyncOrderStatus = 'accepted' | 'duplicate' | 'rejected';

/** One result per submitted order, in the same order. */
export type SyncOrderResult = {
  ulid: string;
  status: SyncOrderStatus;
  /** The stored `Order` (`accepted` / `duplicate`); `null` when rejected. */
  order: Order | null;
  /** Why it was rejected; `null` otherwise. */
  message: string | null;
};

/** GET /api/v1/sync/stock → `data.levels[]`. */
export type StockLevel = {
  product_id: number;
  /** Integer; can be negative. */
  qty: number;
  /** Inventory (v1 completion): the product's reorder level, or `null` (no low-stock alert). */
  reorder_level: number | null;
};

/** §J: `check` when any component of the product's recipe is `out`. */
export type RecipeStockStatus = 'ok' | 'check';

/** GET /api/v1/sync/stock → `data.recipes[]` (§J Sell badges): one per `recipe` product. */
export type RecipeStatus = {
  product_id: number;
  status: RecipeStockStatus;
};

/** GET /api/v1/sync/stock 200 `data`: every non-deleted `track_stock` product of the branch, by `product_id`. */
export type StockSnapshot = {
  levels: StockLevel[];
  /** §J (Round B). An older server leaves it out: read as `[]`. */
  recipes?: RecipeStatus[];
  server_time: IsoDateTime;
};

/** POST /api/v1/orders/{ulid}/review body. */
export type OrderReviewRequest = {
  /** Max 255. */
  note: string | null;
};

/**
 * The printable **local** order a device builds for an offline sale
 * (Device rules → Local write): an `Order` with `invoice_no: null` (the server
 * allocates it at ingest), `order_no`, `queue_no` = the daily sequence,
 * synthetic `items[].id` values (1..n) and `source: "offline"`. Printing,
 * the success screen and the order detail take either kind.
 */
export type PrintableOrder = Omit<Order, 'invoice_no'> & {
  invoice_no: string | null;
};

// ---------------------------------------------------------------------------
// Feature: Shifts & Reporting (Phase 6)
// ---------------------------------------------------------------------------

export type ShiftStatus = 'open' | 'closed';

/**
 * `Shift.flags[]` (`[]` when there are none). `auto_closed`: another shift was
 * opened on the tablet while this one was open. `movement_after_close`: cash
 * was recorded after the close. A string array in the contract, so a flag
 * this build doesn't know is shown as it is.
 */
export type ShiftFlag = 'auto_closed' | 'movement_after_close';

/** `ShiftReport.by_payment_method[]`: always both methods, cash first; cash is net of change. */
export type ShiftReportPaymentMethod = {
  method: PaymentMethod;
  orders_count: number;
  amount_cents: number;
};

/** `ShiftReport.by_cashier[]`: by `net_sales_cents` descending, then name. */
export type ShiftReportCashier = {
  user_id: number;
  name: string;
  orders_count: number;
  net_sales_cents: number;
};

/**
 * `ShiftReport` (the X-read and the Z-read use the same shape). Sums over the
 * shift's orders that are **not `voided`** (Phase 7), with the dashboard
 * `sales` definitions; refunds count in the refund's shift.
 */
export type ShiftReport = {
  orders_count: number;
  items_sold: number;
  gross_sales_cents: number;
  discounts_cents: number;
  net_sales_cents: number;
  vatable_sales_cents: number;
  vat_amount_cents: number;
  vat_exempt_sales_cents: number;
  by_payment_method: ShiftReportPaymentMethod[];
  cash_in_cents: number;
  cash_out_cents: number;
  /** `opening_float_cents` + cash sales + `cash_in_cents` − `cash_out_cents` − cash refunds (Phase 7). */
  expected_cash_cents: number;
  /** `counted_cash_cents` − `expected_cash_cents`; `null` while the shift is open. Negative: the drawer is short. */
  variance_cents: number | null;
  by_cashier: ShiftReportCashier[];
  /** Counted on the server only; always 0 on the tablet. */
  needs_review_count: number;
  /** Voids & Refunds (Phase 7): the shift's voided orders. */
  voids_count: number;
  /** Phase 7: Σ `total_cents` of the shift's voided orders. */
  voids_cents: number;
  /** Phase 7: refunds whose `shift_ulid` is this shift. */
  refunds_count: number;
  refunds_cents: number;
  /** Phase 7: always both methods, cash first. */
  refunds_by_method: ShiftReportRefundMethod[];
  /** Phase 7: `net_sales_cents − refunds_cents`. */
  net_after_refunds_cents: number;
} & ScPwdSalesFigures;

/** `ShiftReport.refunds_by_method[]` (Phase 7): always both methods, cash first. */
export type ShiftReportRefundMethod = {
  method: PaymentMethod;
  amount_cents: number;
};

/** `Shift.device`: the tablet the shift belongs to. */
export type ShiftDevice = {
  id: number;
  code: string;
};

/** Shared object `Shift` (POST /shifts, POST /shifts/{ulid}/close, GET /shifts, GET /shifts/{ulid}). */
export type Shift = {
  /** Generated on the tablet. */
  ulid: string;
  status: ShiftStatus;
  device: ShiftDevice;
  opened_at: IsoDateTime;
  opened_by: UserRef;
  opening_float_cents: number;
  /** `null` while the shift is open. */
  closed_at: IsoDateTime | null;
  closed_by: UserRef | null;
  counted_cash_cents: number | null;
  close_note: string | null;
  /** Computed live from the shift's orders and cash movements. The server's report is the record of truth. */
  report: ShiftReport;
  /** See `ShiftFlag`; `[]` when there are none. */
  flags: string[];
  /** When the server first received the shift. */
  synced_at: IsoDateTime;
};

export type CashMovementType = 'in' | 'out';

/** Shared object `CashMovement` (POST /shifts/{ulid}/cash-movements 201). */
export type CashMovement = {
  ulid: string;
  type: CashMovementType;
  amount_cents: number;
  reason: string;
  occurred_at: IsoDateTime;
  user: UserRef;
};

/** POST /api/v1/shifts body (`shift.open`). Idempotent by `ulid`: a repeat returns the stored shift with 200. */
export type ShiftOpenRequest = {
  ulid: string;
  opened_at: IsoDateTime;
  /** User id. */
  opened_by: number;
  /** `integer:strict`, 0–100000000. */
  opening_float_cents: number;
};

/** POST /api/v1/shifts/{ulid}/cash-movements body (`shift.open`). Idempotent by `ulid`. */
export type CashMovementRequest = {
  ulid: string;
  type: CashMovementType;
  /** `integer:strict`, 1–100000000. */
  amount_cents: number;
  /** Required, max 120. */
  reason: string;
  occurred_at: IsoDateTime;
  user_id: number;
};

/** POST /api/v1/shifts/{ulid}/close body (`shift.close`). The first close wins; a repeat returns the stored shift. */
export type ShiftCloseRequest = {
  closed_at: IsoDateTime;
  /** User id. */
  closed_by: number;
  /** `integer:strict`, 0–1000000000. */
  counted_cash_cents: number;
  /** Max 255. */
  close_note: string | null;
};

/** GET /api/v1/shifts query (`report.zread`): cursor list, `opened_at` descending. */
export type ShiftListParams = CursorParams & {
  /** `YYYY-MM-DD`. */
  business_date?: BusinessDate;
  device_id?: number;
  status?: ShiftStatus;
};

/** `group_by` of the sales report. */
export type SalesReportGroupBy = 'day' | 'product' | 'category' | 'payment' | 'cashier';

/** GET /api/v1/reports/sales (and `/export`) query: all required; `to ≥ from`, at most 366 days. */
export type SalesReportParams = {
  /** `YYYY-MM-DD`. */
  from: BusinessDate;
  /** `YYYY-MM-DD`. */
  to: BusinessDate;
  group_by: SalesReportGroupBy;
};

/**
 * `data.totals`: orders that are not `voided` whose business date is in the
 * range (Phase 7). Voids count on the order's day, refunds on the refund's day.
 */
export type SalesReportTotals = {
  orders_count: number;
  items_sold: number;
  gross_sales_cents: number;
  discounts_cents: number;
  net_sales_cents: number;
  vat_amount_cents: number;
  /** Voids & Refunds (Phase 7). */
  voids_count: number;
  voids_cents: number;
  refunds_count: number;
  refunds_cents: number;
  /** `net_sales_cents − refunds_cents`. */
  net_after_refunds_cents: number;
} & ScPwdSalesFigures;

/**
 * `data.rows[]`. `qty` is `null` for `payment` rows; `gross_sales_cents` and
 * `discounts_cents` are `null` for `payment` rows (their amounts are net of change).
 */
export type SalesReportRow = {
  /** The date, product id, category id, method or user id, as a string. */
  key: string;
  label: string;
  orders_count: number;
  qty: number | null;
  gross_sales_cents: number | null;
  discounts_cents: number | null;
  net_sales_cents: number;
  /** Voids & Refunds (Phase 7): the refunds counted in this row (see the contract's "Where refunds are counted"). */
  refunds_cents: number;
  /** Phase 7: `net_sales_cents − refunds_cents`. */
  net_after_refunds_cents: number;
  /** Phase 7: product and category rows only (from `refund_items`); `null` for other groupings. */
  refunded_qty: number | null;
};

/** GET /api/v1/reports/sales → `data`. */
export type SalesReport = {
  from: BusinessDate;
  to: BusinessDate;
  group_by: SalesReportGroupBy;
  totals: SalesReportTotals;
  /** At most 500; see `SalesReportResponse.meta`. */
  rows: SalesReportRow[];
};

/**
 * GET /api/v1/reports/sales 200. "When more rows exist, `meta.truncated` is
 * `true`". `meta` is always present (Q-013); the app still reads it defensively.
 */
export type SalesReportResponse = {
  data: SalesReport;
  meta?: { truncated?: boolean } | null;
};

// ---------------------------------------------------------------------------
// Feature: Inventory (v1 completion)
// ---------------------------------------------------------------------------

/** Derived stock status (never stored): `out` when qty ≤ 0, `low` when qty ≤ `reorder_level`, else `in_stock`. */
export type StockStatus = 'in_stock' | 'low' | 'out';

/** `status` query filter of the inventory list and report: `alerts` = `low` + `out`. */
export type StockStatusFilter = StockStatus | 'alerts';

/** Shared object `InventoryItem`: a non-deleted `track_stock` product of the caller's branch. */
export type InventoryItem = {
  product_id: number;
  name: string;
  sku: string | null;
  category: ProductCategory;
  image_url: string | null;
  is_available: boolean;
  /** Integer; can be negative. */
  qty: number;
  /** `null`: no low-stock alert. */
  reorder_level: number | null;
  status: StockStatus;
  cost_cents: number;
  /** `max(qty, 0) × cost_cents` (the product's current cost). */
  stock_value_cents: number;
  /** `null` when the product has no movement in the branch. */
  last_movement_at: IsoDateTime | null;
};

/** `meta.summary` of GET /api/v1/inventory: the **whole branch**, ignoring the filters, on every page. */
export type InventorySummary = {
  tracked: number;
  low: number;
  out: number;
};

/** GET /api/v1/inventory 200: the cursor envelope, whose `meta` also carries `summary`. */
export type InventoryPage = CursorPage<InventoryItem> & {
  meta: CursorMeta & { summary: InventorySummary };
};

/** GET /api/v1/inventory query (ordered by `name`, then `product_id`). */
export type InventoryListParams = CursorParams & {
  /** Max 100; case-insensitive contains on name or SKU. */
  search?: string;
  category_id?: number;
  status?: StockStatusFilter;
};

/** `reference` of a sale, void or refund movement. `ulid` is the **order's** ULID. */
export type StockMovementReference = {
  kind: 'order' | 'refund';
  ulid: string;
  /** `invoice_no`, or `order_no` when the invoice is `null`. */
  label: string;
};

/** GET /api/v1/inventory/{product}/movements item (newest first). */
export type InventoryMovement = {
  ulid: string;
  type: StockMovementType;
  qty_delta: number;
  /** The product's branch level right after this movement (a running balance over the whole ledger). */
  qty_after: number;
  /** The cost the movement stored (sale, void, refund and adjustment carry snapshots too), or `null`. The app shows it on a stock in only. */
  unit_cost_cents: number | null;
  reason: string | null;
  occurred_at: IsoDateTime;
  /** `null` when no user wrote the movement (e.g. seeded `opening` stock). */
  created_by: UserRef | null;
  reference: StockMovementReference | null;
};

/** GET /api/v1/inventory/{product}/movements query. */
export type InventoryMovementListParams = CursorParams & {
  type?: StockMovementType;
};

/** PUT /api/v1/inventory/{product}/reorder-level body (`present`, nullable, 0–100000; `null` turns the alert off). */
export type ReorderLevelRequest = {
  reorder_level: number | null;
};

/** GET /api/v1/reports/inventory (and `/export`) query. */
export type InventoryReportParams = {
  /** `YYYY-MM-DD`. */
  from: BusinessDate;
  /** `YYYY-MM-DD`; `to ≥ from`, at most 366 days (inclusive). */
  to: BusinessDate;
  /** Ingredients, Recipes & Purchasing §D: `products` (the default) or `ingredients`. */
  kind?: InventoryReportKind;
  category_id?: number;
  /** Applied to the **current** status. */
  status?: StockStatusFilter;
};

/**
 * `data.totals`: `received`, `sold`, `returned`, `wasted` and `adjusted` are
 * summed over the rows' products; `tracked`, `low`, `out` and
 * `stock_value_cents` are for the whole branch.
 */
export type InventoryReportTotals = {
  tracked: number;
  low: number;
  out: number;
  stock_value_cents: number;
  received: number;
  sold: number;
  returned: number;
  wasted: number;
  /** Can be negative. */
  adjusted: number;
};

/**
 * `data.rows[]`: `opening_qty + received − sold + returned − wasted + adjusted = closing_qty`.
 * `status`, `reorder_level`, `unit_cost_cents` and `stock_value_cents` describe **now**.
 */
export type InventoryReportRow = {
  product_id: number;
  name: string;
  category_name: string;
  opening_qty: number;
  received: number;
  sold: number;
  returned: number;
  wasted: number;
  adjusted: number;
  closing_qty: number;
  reorder_level: number | null;
  status: StockStatus;
  unit_cost_cents: number;
  stock_value_cents: number;
};

/** GET /api/v1/reports/inventory → `data`. */
export type InventoryReport = {
  from: BusinessDate;
  to: BusinessDate;
  totals: InventoryReportTotals;
  /** At most 500 (ordered by name, then id); see `InventoryReportResponse.meta`. */
  rows: InventoryReportRow[];
};

/** GET /api/v1/reports/inventory 200 (`meta.truncated` when more than 500 rows exist). */
export type InventoryReportResponse = {
  data: InventoryReport;
  meta?: { truncated?: boolean } | null;
};

// ---------------------------------------------------------------------------
// Feature: Ingredients, Recipes & Purchasing (Round A)
// ---------------------------------------------------------------------------

/** §A: every unit belongs to one dimension. */
export type UnitDimension = 'mass' | 'volume' | 'count';

/** §A: an ingredient's base unit (`g` mass, `mL` volume, `pc` count). */
export type BaseUnit = 'g' | 'mL' | 'pc';

/**
 * An exact decimal as JSON. Ingredient quantities are strings with exactly 3
 * decimals (`"25000.000"`); factors and `avg_cost` are strings too (Q-025).
 * Readers accept a number as well and never do float math on it: the app
 * converts through `String()` into scaled `BigInt`s (`@/utils/quantity`).
 */
export type DecimalValue = string | number;

/** A quantity in requests (§A): `qty` a decimal string (≤ 3 decimals), `unit` a code valid for the item. */
export type QtyWithUnit = {
  qty: string;
  unit: string;
};

/** GET /api/v1/units item (seeded, read-only). Q-025 shape. */
export type Unit = {
  code: string;
  name: string;
  dimension: UnitDimension;
  /** Exact: 1 `code` = `factor_to_base` × the dimension's base unit. */
  factor_to_base: DecimalValue;
};

/** GET /api/v1/units 200 (Q-025: not paginated). */
export type UnitListResponse = {
  data: Unit[];
};

/** `Ingredient.units[]`: 1 `name` = `factor` × the ingredient's base unit. */
export type IngredientUnit = {
  id: number;
  name: string;
  factor: DecimalValue;
};

/**
 * Shared object `Ingredient` (§D), with the caller's branch fields. Also the
 * item of the ingredient inventory list and read (Q-026).
 */
export type Ingredient = {
  id: number;
  name: string;
  base_unit: BaseUnit;
  /** `true` once the ingredient has any movement, PR item or PO line: the base unit can't change (Q-025). */
  base_unit_locked: boolean;
  image_url: string | null;
  image_path: string | null;
  is_active: boolean;
  units: IngredientUnit[];
  /** Base units, 3 decimals; can be negative. */
  qty: DecimalValue;
  /** Base units, 3 decimals; `null`: no low-stock alert. */
  reorder_level: DecimalValue | null;
  status: StockStatus;
  /** Centavos per base unit, 6 decimals (a rate, never money). */
  avg_cost: DecimalValue;
  stock_value_cents: number;
  last_movement_at: IsoDateTime | null;
};

/** `units[]` in an ingredient create / update (replaced as a set; `id` keeps an existing unit). */
export type IngredientUnitRequest = {
  id?: number;
  /** Max 20, unique per ingredient (case-insensitive), not a standard code of the base unit's dimension. */
  name: string;
  /** Decimal string > 0, ≤ 1,000,000, ≤ 10 decimals. */
  factor: string;
};

/** POST /api/v1/admin/ingredients body (`product.manage`). */
export type IngredientCreateRequest = {
  /** Required, max 120, unique among non-deleted. */
  name: string;
  base_unit: BaseUnit;
  is_active?: boolean;
  units?: IngredientUnitRequest[];
};

/** PATCH /api/v1/admin/ingredients/{id} (partial). `base_unit` → 409 once in use. */
export type IngredientUpdateRequest = Partial<IngredientCreateRequest>;

/** GET /api/v1/admin/ingredients query. Q-025 filters. */
export type IngredientListParams = CursorParams & {
  search?: string;
  is_active?: boolean;
};

/** GET /api/v1/inventory/ingredients query (Q-026). */
export type IngredientInventoryListParams = CursorParams & {
  search?: string;
  status?: StockStatusFilter;
};

/** GET /api/v1/inventory/ingredients 200: the cursor envelope plus the branch-wide `meta.summary`. */
export type IngredientInventoryPage = CursorPage<Ingredient> & {
  meta: CursorMeta & { summary: InventorySummary };
};

/** `reference` of an ingredient movement: its order, refund or PO receipt (Q-026: `purchase_order`). */
export type IngredientMovementReference = {
  kind: 'order' | 'refund' | 'purchase_order';
  /** The order's or the purchase order's ULID. */
  ulid: string;
  /** `invoice_no` / `order_no`, or the `po_no`. */
  label: string;
};

/**
 * An ingredient movement's type: the product types plus §D1 `revaluation`
 * (a manual cost: `qty_delta "0.000"`, the value change in `value_cents`,
 * the price in `unit_cost_cents` per `entered_unit`).
 */
export type IngredientMovementType = StockMovementType | 'revaluation';

/** GET /api/v1/inventory/ingredients/{id}/movements query (§D1 adds `type=revaluation`). */
export type IngredientMovementListParams = CursorParams & {
  type?: IngredientMovementType;
};

/** GET /api/v1/inventory/ingredients/{id}/movements item (Q-026 shape). */
export type IngredientMovement = {
  ulid: string;
  type: IngredientMovementType;
  /** Base units, 3 decimals, signed. */
  qty_delta: DecimalValue;
  /** The running balance right after this movement. */
  qty_after: DecimalValue;
  /** What the user typed, and in which unit. */
  entered_qty: DecimalValue | null;
  entered_unit: string | null;
  unit_cost_cents: number | null;
  /** Signed: the value moved. */
  value_cents: number;
  reason: string | null;
  occurred_at: IsoDateTime;
  created_by: UserRef | null;
  reference: IngredientMovementReference | null;
};

/** Ingredient adjustments allow these `type`s (`receipt` comes from receiving only). */
export type IngredientStockAdjustmentType = 'adjustment' | 'count' | 'wastage';

/**
 * POST /api/v1/admin/ingredients/{id}/stock-adjustments body (Idempotent:
 * `Idempotency-Key` = `ulid`). Q-026: `adjustment` → `qty` ≠ 0 (signed);
 * `count` → `qty` ≥ 0 (counted); `wastage` → `qty` < 0.
 */
export type IngredientStockAdjustmentRequest = {
  ulid: string;
  type: IngredientStockAdjustmentType;
  qty: string;
  unit: string;
  reason: string;
};

/** POST /api/v1/admin/ingredients/{id}/stock-adjustments 201 `data`: the movement item plus these (Q-026). */
export type IngredientStockAdjustmentResult = IngredientMovement & {
  ingredient_id: number;
  qty_before: DecimalValue;
};

/**
 * POST /api/v1/admin/ingredients/{id}/cost body (§D1, `inventory.adjust`;
 * idempotent: `Idempotency-Key` = `ulid`). `cost_cents` is the price of
 * **one** `unit` (integer, 1–100,000,000); `unit` is any unit valid for the
 * ingredient. The 200 is `{ data: Ingredient }` with the new `avg_cost`.
 */
export type IngredientCostRequest = {
  ulid: string;
  cost_cents: number;
  unit: string;
  reason?: string;
};

/** PUT /api/v1/inventory/ingredients/{id}/reorder-level body (Q-026: wrapped in `reorder_level`). */
export type IngredientReorderLevelRequest = {
  reorder_level: QtyWithUnit | null;
};

// Suppliers (§C) -------------------------------------------------------------

/** Shared object `Supplier`. */
export type Supplier = {
  id: number;
  name: string;
  contact_person: string | null;
  contact_number: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
};

/** GET /api/v1/admin/suppliers query. */
export type SupplierListParams = CursorParams & {
  /** Name or contact. */
  search?: string;
  is_active?: boolean;
};

/** POST /api/v1/admin/suppliers body (`supplier.manage`). */
export type SupplierCreateRequest = {
  /** Required, max 120, unique among non-deleted. */
  name: string;
  contact_person?: string | null;
  /** Max 30. */
  contact_number?: string | null;
  email?: string | null;
  /** Max 255. */
  address?: string | null;
  is_active?: boolean;
};

export type SupplierUpdateRequest = Partial<SupplierCreateRequest>;

// Purchasing (§F–§H) ----------------------------------------------------------

export type PurchaseItemType = 'ingredient' | 'product';

/** `item` of a PR item or PO line. */
export type PurchaseItemRef = {
  type: PurchaseItemType;
  id: number;
  name: string;
};

/** `{ id, name }` of a supplier on a PR item or PO line. */
export type SupplierRef = {
  id: number;
  name: string;
};

/** PR `status` (stored, derived from the items), plus `cancelled` after a DELETE. */
export type PurchaseRequestStatus = 'pending_approval' | 'approved' | 'partially_approved' | 'declined' | 'cancelled';

/** A PR item's decision. */
export type PurchaseDecision = 'pending' | 'approved' | 'declined';

/** PO `status`. */
export type PurchaseOrderStatus = 'pending_approval' | 'approved' | 'declined';

/** PO `receiving_status`. */
export type PurchaseOrderReceivingStatus = 'not_received' | 'partially_received' | 'fully_received';

/** A PO line's `receiving_status`. */
export type PurchaseLineReceivingStatus = 'pending' | 'partial' | 'complete' | 'over_received';

/** `timeline[]`: audit entries. Q-027: `details` is a worded string or `null`; `by` may be `null`. */
export type PurchaseTimelineEntry = {
  at: IsoDateTime;
  action: string;
  by: UserRef | null;
  details: string | null;
};

/** `PurchaseRequest.items[]`. */
export type PurchaseRequestItem = {
  id: number;
  item: PurchaseItemRef;
  supplier: SupplierRef;
  /** Q-027: a 3-decimal string for an ingredient, an integer for a product. */
  qty: DecimalValue;
  unit: string;
  base_qty: DecimalValue;
  /** Per entered unit. */
  estimated_unit_price_cents: number | null;
  remarks: string | null;
  decision: PurchaseDecision;
  decision_reason: string | null;
  decided_by: UserRef | null;
  decided_at: IsoDateTime | null;
};

/** `PurchaseRequest.purchase_order`: the one PO created from it. */
export type PurchaseOrderRef = {
  ulid: string;
  po_no: string;
  status: PurchaseOrderStatus;
};

/** Shared object `PurchaseRequest` (`timeline` on `GET /{ulid}` only). */
export type PurchaseRequest = {
  ulid: string;
  /** `PR-{branch.code}-{YYYY}-{00001}`. */
  pr_no: string;
  status: PurchaseRequestStatus;
  requested_by: UserRef;
  date_needed: BusinessDate | null;
  remarks: string | null;
  created_at: IsoDateTime;
  items: PurchaseRequestItem[];
  purchase_order: PurchaseOrderRef | null;
  timeline?: PurchaseTimelineEntry[];
};

/** GET /api/v1/purchase-requests query (newest first). */
export type PurchaseRequestListParams = CursorParams & {
  status?: PurchaseRequestStatus;
  supplier_id?: number;
  /** `pr_no` or item name. */
  search?: string;
  mine?: boolean;
  needs_decision?: boolean;
};

/** One item of a PR create / update body (`id` only when updating an existing item). */
export type PurchaseRequestItemRequest = {
  id?: number;
  item_type: PurchaseItemType;
  item_id: number;
  supplier_id: number;
  qty: string;
  unit: string;
  estimated_unit_price_cents?: number | null;
  remarks?: string | null;
};

/** POST /api/v1/purchase-requests body (`purchase.request`; Idempotent: `Idempotency-Key` = `ulid`). */
export type PurchaseRequestCreateRequest = {
  ulid: string;
  date_needed?: BusinessDate | null;
  remarks?: string | null;
  /** 1..100. */
  items: PurchaseRequestItemRequest[];
};

/** PATCH /api/v1/purchase-requests/{ulid}: items by `id` (new ones without, missing ids removed). */
export type PurchaseRequestUpdateRequest = {
  date_needed?: BusinessDate | null;
  remarks?: string | null;
  items?: PurchaseRequestItemRequest[];
};

/** One decision (`reason` required, max 255, for `declined`). */
export type PurchaseDecisionEntry = {
  item_id: number;
  decision: 'approved' | 'declined';
  reason?: string;
};

/** POST /api/v1/purchase-requests/{ulid}/decisions body. */
export type PurchaseDecisionRequest = {
  decisions: PurchaseDecisionEntry[];
};

/** `PurchaseOrder.lines[]`. */
export type PurchaseOrderLine = {
  id: number;
  item: PurchaseItemRef;
  supplier: SupplierRef;
  qty: DecimalValue;
  unit: string;
  base_qty: DecimalValue;
  unit_price_cents: number;
  /** `round_half_up(unit_price_cents × qty, 0)`. */
  line_total_cents: number;
  received_base_qty: DecimalValue;
  /** In the line's unit, 3 decimals. */
  received_qty: DecimalValue;
  /** `max(qty − received_qty, 0)`. */
  remaining_qty: DecimalValue;
  receiving_status: PurchaseLineReceivingStatus;
};

/** `receipts[].lines[]` (Q-027 shape). */
export type GoodsReceiptLine = {
  po_line_id: number;
  qty: DecimalValue;
  unit: string;
  base_qty: DecimalValue;
  cost_cents: number;
  reason: string | null;
};

/** `PurchaseOrder.receipts[]`, newest first: append-only (Q-027 shape). */
export type GoodsReceipt = {
  ulid: string;
  received_by: UserRef | null;
  received_at: IsoDateTime;
  remarks: string | null;
  lines: GoodsReceiptLine[];
};

/** Shared object `PurchaseOrder`. */
export type PurchaseOrder = {
  ulid: string;
  /** `PO-{branch.code}-{YYYY}-{00001}`. */
  po_no: string;
  status: PurchaseOrderStatus;
  receiving_status: PurchaseOrderReceivingStatus;
  purchase_request: { ulid: string; pr_no: string };
  /** Q-027: `{id, name}` or `null`. */
  created_by: UserRef | null;
  approved_by: UserRef | null;
  approved_at: IsoDateTime | null;
  decline_reason: string | null;
  expected_delivery_date: BusinessDate | null;
  remarks: string | null;
  total_cents: number;
  lines: PurchaseOrderLine[];
  /** Q-027: may be empty in lists. */
  receipts: GoodsReceipt[];
  timeline: PurchaseTimelineEntry[];
};

/** GET /api/v1/purchase-orders query. */
export type PurchaseOrderListParams = CursorParams & {
  status?: PurchaseOrderStatus;
  receiving_status?: PurchaseOrderReceivingStatus;
  supplier_id?: number;
  search?: string;
  /** Approved and not fully received. */
  to_receive?: boolean;
};

/** One line edit of a PO PATCH (by `id`). */
export type PurchaseOrderLineUpdate = {
  id: number;
  qty?: string;
  unit?: string;
  unit_price_cents?: number;
  supplier_id?: number;
};

/** PATCH /api/v1/purchase-orders/{ulid} (`pending_approval` only; Q-027 body). */
export type PurchaseOrderUpdateRequest = {
  expected_delivery_date?: BusinessDate | null;
  remarks?: string | null;
  lines?: PurchaseOrderLineUpdate[];
};

/** POST /api/v1/purchase-orders/{ulid}/decline body. */
export type PurchaseOrderDeclineRequest = {
  /** Required, max 255. */
  reason: string;
};

/** One line of a receipt: `qty` > 0, or < 0 for a correction (then `reason` is required). */
export type GoodsReceiptLineRequest = {
  po_line_id: number;
  qty: string;
  unit: string;
  reason?: string;
};

/** POST /api/v1/purchase-orders/{ulid}/receipts body (`purchase.receive`; Idempotent: `Idempotency-Key` = `ulid`). */
export type GoodsReceiptRequest = {
  ulid: string;
  remarks?: string | null;
  /** 1..100. */
  lines: GoodsReceiptLineRequest[];
};

// Reports (§D, §I) -------------------------------------------------------------

/** GET /api/v1/reports/inventory `kind`. */
export type InventoryReportKind = 'products' | 'ingredients';

/** Ingredient rows of the inventory report (Q-028 shape; quantities in base units). */
export type IngredientReportRow = {
  ingredient_id: number;
  name: string;
  base_unit: BaseUnit;
  opening_qty: DecimalValue;
  received: DecimalValue;
  used: DecimalValue;
  returned: DecimalValue;
  wasted: DecimalValue;
  adjusted: DecimalValue;
  closing_qty: DecimalValue;
  reorder_level: DecimalValue | null;
  status: StockStatus;
  avg_cost: DecimalValue;
  stock_value_cents: number;
  value_in_cents: number;
  value_out_cents: number;
};

/** Ingredient totals (Q-028; the app shows the ones it finds). */
export type IngredientReportTotals = {
  tracked?: number;
  low?: number;
  out?: number;
  stock_value_cents?: number;
  value_in_cents?: number;
  value_out_cents?: number;
};

/** GET /api/v1/reports/inventory?kind=ingredients → `data`. */
export type IngredientReport = {
  from: BusinessDate;
  to: BusinessDate;
  totals: IngredientReportTotals;
  rows: IngredientReportRow[];
};

export type IngredientReportResponse = {
  data: IngredientReport;
  meta?: { truncated?: boolean } | null;
};

/** GET /api/v1/reports/purchasing (and `/export`) query (`report.view` or `purchase.approve`). */
export type PurchasingReportParams = {
  /** PR created date (business days), max 366. */
  from: BusinessDate;
  to: BusinessDate;
  status?: PurchaseRequestStatus;
  decision?: PurchaseDecision;
  po_status?: PurchaseOrderStatus;
  /** Q-028: a line value filters the line; a PO value filters the PO (the app offers the line values). */
  receiving_status?: PurchaseLineReceivingStatus | PurchaseOrderReceivingStatus;
  supplier_id?: number;
  item_type?: PurchaseItemType;
  item_id?: number;
};

/** A row per PR item (Q-028 shape; PO fields `null` without a PO line). */
export type PurchasingReportRow = {
  pr_no: string;
  pr_date: BusinessDate;
  requested_by: string;
  item_name: string;
  supplier_name: string;
  requested_qty: DecimalValue;
  unit: string;
  decision: PurchaseDecision;
  decision_reason: string | null;
  decided_by: string | null;
  po_no: string | null;
  po_status: PurchaseOrderStatus | null;
  ordered_qty: DecimalValue | null;
  received_qty: DecimalValue | null;
  remaining_qty: DecimalValue | null;
  line_receiving_status: PurchaseLineReceivingStatus | null;
  unit_price_cents: number | null;
  ordered_cents: number | null;
  received_cents: number | null;
  last_received_at: IsoDateTime | null;
};

/** `data.totals` (Q-028: `pos` by PO status). */
export type PurchasingReportTotals = {
  prs: number;
  items: number;
  approved: number;
  declined: number;
  pending: number;
  pos: Partial<Record<PurchaseOrderStatus, number>>;
  ordered_cents: number;
  received_cents: number;
  remaining_cents: number;
};

export type PurchasingReport = {
  from: BusinessDate;
  to: BusinessDate;
  totals: PurchasingReportTotals;
  /** At most 500 (`meta.truncated`). */
  rows: PurchasingReportRow[];
};

export type PurchasingReportResponse = {
  data: PurchasingReport;
  meta?: { truncated?: boolean } | null;
};

// ---------------------------------------------------------------------------
// Feature: Ingredients, Recipes & Purchasing §J: recipes (Round B)
// ---------------------------------------------------------------------------

/** A recipe component: an ingredient, or a product with `stock_mode = own` (no nesting). */
export type RecipeComponentType = 'ingredient' | 'product';

/** `Recipe.lines[].component`. A product's `base_unit` is `pc`. */
export type RecipeComponent = {
  type: RecipeComponentType;
  id: number;
  name: string;
  base_unit: BaseUnit;
};

/** The fields every `Recipe.lines[]` item has (per 1 serving). */
type RecipeLineBase = {
  unit: string;
  /** Centavos per base unit, always a 6-decimal string (Q-031): an ingredient's `avg_cost`, an own product's `cost_cents`. */
  unit_cost: string;
  /** `round_half_up(base_qty × unit_cost, 0)`. */
  line_cost_cents: number;
};

/** An ingredient line: `qty` (as entered) and `base_qty` are 3-decimal strings. */
export type RecipeIngredientLine = RecipeLineBase & {
  component: RecipeComponent & { type: 'ingredient' };
  qty: string;
  /** `round_half_up(qty × factor, 3)` in the ingredient's base unit. */
  base_qty: string;
};

/** An own-product line: `qty` and `base_qty` are integers (pieces; Q-027 / Q-031). */
export type RecipeProductLine = RecipeLineBase & {
  component: RecipeComponent & { type: 'product' };
  qty: number;
  base_qty: number;
};

/** `Recipe.lines[]`: discriminated on `component.type`. */
export type RecipeLine = RecipeIngredientLine | RecipeProductLine;

/** GET / PUT /api/v1/admin/products/{id}/recipe 200 `data`. */
export type Recipe = {
  lines: RecipeLine[];
  /** Σ `line_cost_cents`: the cost of one serving. */
  cost_cents: number;
  price_cents: number;
  /** `trunc((price − cost) × 10000 / price)` toward zero; `null` when `price_cents` or `cost_cents` is 0 (Q-031). */
  margin_bps: BasisPoints | null;
};

/** `lines[]` of PUT /api/v1/admin/products/{id}/recipe. */
export type RecipeLineRequest =
  | {
      component_type: 'ingredient';
      component_id: number;
      /** Decimal string, > 0, ≤ 3 decimals, ≤ 1,000,000. */
      qty: string;
      /** A unit valid for the ingredient (§A). */
      unit: string;
    }
  | {
      component_type: 'product';
      component_id: number;
      /** A whole number of pieces, > 0 (Q-031). */
      qty: number;
      unit: 'pc';
    };

/** PUT /api/v1/admin/products/{id}/recipe body: the whole recipe (0..50 lines, no duplicate component). */
export type RecipeUpdateRequest = {
  lines: RecipeLineRequest[];
};
