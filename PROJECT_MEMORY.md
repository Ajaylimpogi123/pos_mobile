# POS Rebuild — PROJECT MEMORY

**Status:** Design complete, no implementation started.
**Provenance:** Derived from a full audit of the legacy Laravel 11 + Inertia/React POS at `c:\xampp\htdocs\pos`. The legacy system is the **reference for business requirements only** — its frontend, schema conventions, and most of its technical patterns are deliberately *not* carried over (see Appendix A.3).
**Target stack:** Laravel (REST API) + MySQL · React Native + Expo + Expo Router.
**How to use:** This is the source of truth for the new project. Copy it into the new repo root and update it whenever a decision changes.

**Locked decisions (confirmed with the business owner):**
| Decision | Choice |
|---|---|
| Printing | Tablet prints **directly** over WiFi/LAN via TCP to the printer. No PC, no bridge, no agent. |
| Offline | **Full offline-first.** Sell, print, and checkout with zero internet; sync when back online. |
| Branches | Single store for now, but `branch_id` present and **enforced** from day one. |
| v1 scope | **Core POS.** Recipes/ingredients and purchasing deferred to v2. |

---

## 1. Business Requirements

### 1.1 The business
A restaurant / food-service operation in the Philippines (₱, cash + GCash). Staff ring up orders at a counter, take payment, print a customer receipt, and send a preparation ticket to the kitchen. Stock depletes as items sell. Management needs daily sales visibility and, later, ingredient-level cost control and supplier purchasing.

### 1.2 Actors
| Actor | Needs |
|---|---|
| **Cashier** | Fast order entry, reliable checkout, receipt + kitchen ticket printing, works when internet is down |
| **Manager / Admin** | Menu and price management, voids/refunds approval, discounts beyond cashier limits, sales reporting, shift reconciliation, user management |
| **Owner / Superadmin** | Everything, plus multi-branch oversight and configuration |
| **Kitchen** | Legible prep tickets showing only newly-added items |

### 1.3 Functional requirements (v1)
1. Authenticate staff; enforce what each role may do **on the server**.
2. Browse a menu by category; build an order; adjust quantities; remove lines.
3. Apply an order-level discount within the cashier's permitted limit; above it requires manager authorization.
4. Take payment by cash or GCash (reference number required for GCash); support **split tender**.
5. Complete a sale atomically: record the order, its lines, its payments, and its stock movements.
6. Print a customer receipt and a kitchen ticket; kitchen tickets show **only items not yet sent**.
7. Void a completed sale (with reason + authorization), reversing stock.
8. Refund a sale in full or in part.
9. Open and close a cashier shift with opening float and counted cash, producing a variance.
10. Deplete product stock on sale; surface low-stock and out-of-stock states.
11. Report on sales by day, product, payment method, and cashier; produce X-read and Z-read.
12. Operate **fully offline** and reconcile automatically on reconnection.

### 1.4 Non-functional requirements
- **Never lose a sale.** A completed transaction survives printer failure, network failure, and app restart.
- **Never trust the client for money.** All totals recomputed server-side.
- **Fast.** Add-to-cart and checkout must feel instant, offline or online.
- **Auditable.** Every financial mutation records who, what, when.
- **Scalable reads.** No endpoint may return an unbounded table.
- **Tablet-first.** Designed for a 10" Android tablet in landscape, usable one-handed at a counter.

### 1.5 Explicitly out of scope for v1
Ingredient/recipe stock depletion, unit conversions, suppliers, purchase requests/orders/receiving, table & seat management, delivery integrations, customer loyalty, multi-currency.

---

## 2. Features

| Module | v1 | v2 | Later |
|---|:--:|:--:|:--:|
| Auth (token), RBAC, PIN quick-switch | ✅ | | |
| Users, roles, permissions | ✅ | | |
| Categories, products, pricing | ✅ | | |
| Customers (optional on a sale) | ✅ | | |
| Cart (local), checkout, split payments | ✅ | | |
| Discounts (incl. SC/PWD types) | ✅ | | |
| VAT breakdown / BIR-shaped receipt | ✅ | | |
| Product-level stock + movement ledger | ✅ | | |
| Void / refund with authorization | ✅ | | |
| Shifts, X-read, Z-read, cash variance | ✅ | | |
| Receipt + kitchen printing (direct TCP) | ✅ | | |
| Sales reporting + dashboard | ✅ | | |
| Offline-first + sync | ✅ | | |
| Ingredients, recipes, ingredient depletion | | ✅ | |
| Unit conversions (server-side, enforced) | | ✅ | |
| Suppliers, PR → PO → goods receipt, costing | | ✅ | |
| Multi-branch activation, transfers | | | ✅ |
| Bluetooth printing fallback | | | ✅ |
| Loyalty, promos, happy-hour pricing | | | ✅ |

---

## 3. Workflows

### 3.1 Sale (the critical path)
1. Cashier opens a shift (opening float recorded) — required before selling.
2. Browse categories → tap product → it enters the **local** cart. Qty adjustable. Cart never touches the server.
3. Cashier taps Checkout. Client shows subtotal, discount, VAT breakdown, total — all computed locally **for display only**.
4. Cashier selects tender(s), enters amount(s). GCash requires a reference number.
5. Confirm Sale. Client:
   - generates a **ULID** and a device-local `order_no`,
   - writes the order + items + payments to local SQLite **inside one transaction**,
   - enqueues it in the outbox,
   - immediately prints receipt + kitchen ticket,
   - clears the cart, shows change due.
6. Sync worker pushes the order. Server recomputes all money, validates, assigns `invoice_no`, writes stock movements, returns the canonical record. Client reconciles.
7. **The sale is complete at step 5.** Printing and syncing are consequences, never preconditions.

### 3.2 Kitchen ticket
Tickets print only the delta between what the order now contains and what was already sent to that printer. Each printed line is recorded locally as `sent_qty` per order line per printer. Re-firing a ticket prints only new items; an explicit "Reprint full ticket" action exists for lost paper. Routing is per category → printer (food → kitchen, drinks → bar); unmapped categories fall back to the default kitchen printer.

### 3.3 Void
Manager-authorized, reason required, allowed only within a configurable window (default: same shift). Creates reversing stock movements and a `voided` order state. **Never deletes the order.** Prints a void slip.

### 3.4 Refund
Full or per-line. Creates a linked refund record + reversing stock movements + a negative payment. Original order becomes `refunded` or `partially_refunded`. Requires permission and a reason.

### 3.5 Shift close (Z-read)
Cashier enters counted cash. System computes expected = opening float + cash sales − cash refunds, reports variance, locks the shift, and produces the Z-read (gross, net, VAT, discounts by type, tender breakdown, void/refund counts, transaction range).

### 3.6 Offline day-in-the-life
Internet drops mid-service. Cashier keeps selling: cart, checkout, receipt, and kitchen ticket all work (printer is on the same LAN, which is unaffected). Each sale queues. A persistent banner shows "Offline — N sales pending". Internet returns; the worker drains the queue oldest-first; the banner clears. Any sale the server adjusts (e.g. a price changed mid-outage) is flagged for manager review rather than silently rewritten.

### 3.7 Purchasing (v2, corrected from legacy)
PR raised → **approved by someone other than the requester** → manually converted to one PO **per supplier** → PO approved → goods received against it (each receipt is its own immutable record) → stock and weighted-average cost updated **in the ingredient's own stocking unit**.

---

## 4. Business Rules (authoritative)

### 4.1 Money
- All monetary values are **integer minor units (centavos)** end-to-end — database, API, and client. No floats, ever.
- The **server is the sole authority** on every amount. It recomputes subtotal, discounts, VAT, and total from the submitted line items and its own price list.
- The client sends its computed total **only as a checksum**. A mismatch beyond ±1 centavo (rounding) is recorded on the order as `client_total_mismatch` for review; for an already-completed offline sale the **server's figure wins and the sale is still accepted** — never reject money that has already changed hands.
- Unit price is **snapshotted onto the order line** at sale time, along with product name, category name, and unit cost. History must never be rewritten by later master-data edits.

### 4.2 Discounts
- Order-level and line-level discounts are both supported; each carries an explicit **type**: `none`, `promo`, `senior_citizen`, `pwd`, `employee`, `manual`.
- A discount may never exceed the discountable base. Enforced server-side.
- Each role has a `max_discount_percent`. Exceeding it requires a manager PIN override, which is recorded on the order (`authorized_by`).
- SC/PWD discounts follow Philippine rules (VAT-exempt + 20% on eligible items) and require an ID reference — **confirm exact treatment with the client's accountant before implementing.**

### 4.3 Payments
- An order has **one or more** payments (split tender). `sum(payments.amount) >= order.total`.
- Cash records `tendered` and `change`. Non-cash requires `reference_no`.
- Underpayment is rejected server-side; overpayment is only valid for cash (becomes change).

### 4.4 Numbering
| Number | Scope | Generated | Format |
|---|---|---|---|
| `order_no` | per device, per business day | **Client, offline-safe** | `{DEVICE}-{YYYYMMDD}-{0001}` |
| `invoice_no` | per branch, sequential | **Server**, at ingest | `INV-{branch}-{00000001}` |
| `queue_no` | per branch, per business day | Server; device-local fallback offline | integer |

- `invoice_no` and `(device_id, order_no)` both carry **UNIQUE indexes**. Numbering is never derived from `COUNT(*)`.
- **Business day** is computed in the branch's timezone with a configurable day-start (e.g. 04:00), not UTC midnight.

### 4.5 Stock (v1: product level)
- Current stock is a **cached column** on `stock_levels`, always written in the same transaction as an append-only `stock_movements` row. The ledger is the truth; the cache is reconcilable at any time.
- Sale → negative movement. Void/refund → positive reversing movement. Manual adjustment → movement with reason. Receipt (v2) → positive movement with unit cost.
- **Online checkout** validates availability *before* committing and blocks on insufficient stock (aggregating demand across all lines for the same product — the legacy per-line check was wrong).
- **Offline checkout** decrements the local cache optimistically and warns, but **never blocks the sale**. On sync the server applies the movement even if it drives stock negative, and flags an oversell for reporting. The sale physically happened; the books must reflect it.
- Stock status (`in_stock` / `low_stock` / `out_of_stock`) is **derived** from qty vs reorder threshold. It is never a stored, hand-written string.

### 4.6 Recipes & units (v2)
- A recipe line stores quantity per one unit of product **in the ingredient's stocking unit**.
- Unit conversion is a **server-side, enforced** concern. Conversions are stored per ingredient (`1 from_unit = factor × stocking_unit`) and applied at every point quantities cross units — recipes *and* goods receipt.
- A quantity in a unit with no known conversion is **rejected**, never silently stored as-is.
- Changing an ingredient's stocking unit requires an explicit migration path; it may not silently invalidate existing recipes and stock.

### 4.7 Voids & refunds
- Orders are **never deleted**. State machine: `completed → voided | refunded | partially_refunded`.
- Every transition requires permission, a reason, and is written to `audit_logs`.
- Reversing stock movements are mandatory and part of the same transaction.

### 4.8 Purchasing (v2, corrected)
- **Separation of duties**: the requester may not approve their own PR or PO.
- One PO **per supplier** (legacy forced one PO per PR with a null supplier — wrong).
- Receiving is **append-only**: each receipt is its own record with quantity, unit, unit cost, and receiver. `quantity_received` on the PO line is a derived sum, never an overwritten field.
- Over-receipt is blocked; **under-receipt and corrections are supported** via a negative/corrective receipt, which properly reverses stock.
- Weighted average cost on receipt (preserved from legacy, which was correct):
  `newCost = ((oldQty × oldCost) + (receivedQty × unitCost)) / (oldQty + receivedQty)`
  with `newQty == 0` leaving cost unchanged, and quantities **converted to the stocking unit first**.
- A PO line may not be approved with a zero unit price (legacy allowed this, silently dragging average cost to zero).
- Statuses that exist must be reachable; statuses that aren't implemented are not declared.

### 4.9 Rules deliberately CHANGED from legacy
| Legacy behaviour | New rule | Why |
|---|---|---|
| Server accepts client's totals, prices, discounts verbatim | Server recomputes everything | A crafted request could record ₱0.01 for a ₱5,000 sale |
| `pd_qty` never validated at checkout | Stock validated (online) / flagged (offline) | Unlimited overselling |
| Per-line stock validation | Demand aggregated per product across the order | Two lines of the same item both passed against full stock |
| Overdraw silently clamped via `max(0, …)` | Movement recorded truthfully; negative allowed + flagged | Phantom inventory, unreconcilable |
| One global shared cart in the database | Cart is **local client state**, never persisted server-side | Cashiers overwrote each other; checkout wiped everyone's cart |
| Every order forced onto a "Walk-in Customer" row | `customer_id` nullable | Polluted the customer table and its metrics |
| Order has no cashier, no branch, no status | All three are first-class | No accountability, no void, no per-branch revenue |
| Stock status stored as free-text, written by 3 conflicting code paths | Derived, single definition | Restocking left items reading "Out of Stock" |
| Unit conversion applied once in the browser | Enforced server-side at every boundary | Silent unit corruption of stock and cost |
| Numbering from `COUNT(*) + 1`, no unique index | Sequence tables + UNIQUE constraints | Duplicate/reused invoice and queue numbers |
| `APP_TIMEZONE=UTC`, day rolls at 08:00 local | Branch timezone + configurable day-start | Queue reset mid-service |
| Public self-registration auto-grants a working account | Admin-invite only | Anyone on the internet could create an account |
| No authorization anywhere | Policy-enforced on every mutation | A cashier could create admins and approve POs |

---

## 5. Database Design

### 5.1 Conventions
- Plural snake_case table names. **No `tbl_` prefix.** Standard `id` bigint PK on every table. **No custom PK names.**
- Transactional tables additionally carry a `ulid` CHAR(26) **UNIQUE** — client-generated, the idempotency key.
- Money: `bigint` centavos, suffixed `_cents`. Quantities: `decimal(12,4)`. Timestamps: UTC.
- Every table: `created_at`, `updated_at`. Mutable business entities: `created_by`, `updated_by`.
- Soft deletes **only** on master data (products, categories, customers, suppliers, users). Never on financial records.
- Foreign keys to financial data use `RESTRICT`. **No `CASCADE` may ever reach an order.**

### 5.2 Core tables (v1)

**Identity & access**
- `branches` — name, code, timezone, address, tax fields, `day_start_time`, is_active
- `roles` — name, slug (stable key), max_discount_percent, is_admin
- `permissions` — slug, description
- `permission_role`
- `users` — branch_id, role_id, name, email (unique), password, `pin_hash`, is_active, last_login_at
- `devices` — branch_id, code (unique, used in `order_no`), name, last_seen_at, app_version
- `personal_access_tokens` (Sanctum)

**Catalogue**
- `categories` — name, description, image_path, sort_order, is_active
- `products` — category_id, sku, name, description, image_path, `price_cents`, `cost_cents`, `is_vatable`, `is_available`, `track_stock`, sort_order
  *(global master data — not duplicated per branch)*
- `customers` — first_name, last_name, contact, email, notes

**Sales**
- `shifts` — branch_id, device_id, opened_by, opened_at, `opening_float_cents`, closed_by, closed_at, `counted_cash_cents`, `expected_cash_cents`, `variance_cents`, status
- `orders` — `ulid` UNIQUE, branch_id, device_id, shift_id, user_id (cashier), customer_id (**nullable**), `order_no`, `invoice_no` UNIQUE, queue_no, status, `subtotal_cents`, `discount_cents`, discount_type, `vatable_sales_cents`, `vat_amount_cents`, `vat_exempt_sales_cents`, `total_cents`, notes, placed_at, synced_at, voided_at/voided_by/void_reason, authorized_by, `client_total_cents`, `has_total_mismatch`
  UNIQUE `(device_id, order_no)`
- `order_items` — order_id, product_id (RESTRICT), **snapshots**: product_name, category_name, `unit_price_cents`, `unit_cost_cents`; qty, `line_discount_cents`, `line_total_cents`, notes
- `payments` — order_id, method, `amount_cents`, `tendered_cents`, `change_cents`, reference_no, is_refund
- `refunds` — order_id, `ulid`, `amount_cents`, reason, refunded_by, created_at
- `refund_items` — refund_id, order_item_id, qty, `amount_cents`

**Inventory**
- `stock_levels` — branch_id, product_id, qty, reorder_threshold — UNIQUE `(branch_id, product_id)`
- `stock_movements` — `ulid` UNIQUE, branch_id, product_id, type (`sale|void|refund|adjustment|receipt|wastage|opening|transfer`), `qty_delta`, `unit_cost_cents`, reference_type, reference_id, reason, occurred_at, created_by

**Printing**
- `printers` — branch_id, name, role (`cashier|kitchen|bar`), connection (`network|bluetooth`), host, port, is_enabled
- `print_routes` — branch_id, category_id, printer_id
- `order_item_prints` — order_item_id, printer_id, `sent_qty` *(drives kitchen-ticket deltas; replaces legacy `ct_printed_qty`)*

**Platform**
- `audit_logs` — actor_id, action, subject_type, subject_id, changes (json), ip, created_at
- `idempotency_keys` — key UNIQUE, user_id, endpoint, status, response (json), created_at
- `settings` — branch_id, key, value (json)
- `invoice_sequences` — branch_id, period, next_value *(row-locked allocation; never `COUNT(*)`)*

### 5.3 v2 additions
`suppliers`, `ingredients`, `ingredient_units` (conversions), `product_ingredients` (recipes), `purchase_requests` + `_items`, `purchase_orders` + `_items`, `goods_receipts` + `_lines`. Stock tables generalise from `product_id` to a polymorphic `stockable` (product **or** ingredient).

### 5.4 Indexes (mandatory)
`orders`: `(branch_id, placed_at)`, `(shift_id)`, `(user_id, placed_at)`, `status`, UNIQUE `invoice_no`, UNIQUE `ulid`, UNIQUE `(device_id, order_no)`.
`order_items`: `(order_id)`, `(product_id, created_at)`.
`stock_movements`: `(branch_id, product_id, occurred_at)`, UNIQUE `ulid`.
`products`: `(category_id, is_available)`, `name`, `sku`.
`customers`: `contact`, `last_name`.
All sync-pulled tables: `updated_at`.

### 5.5 Key schema decisions
- **Denormalised order lines.** Product name, category, price, and cost are frozen at sale time so master-data edits can never rewrite financial history (a real legacy defect).
- **Ledger + cache for stock.** Enables offline reconciliation, audit, and COGS, none of which the legacy mutate-in-place model could support.
- **Stock separated from products.** Multi-branch works later without duplicating product rows and fragmenting reporting.
- **No cart table.** The single worst legacy pattern; the cart is client state.

---

## 6. Laravel API Architecture

### 6.1 Stack
Laravel (latest LTS-ish) · MySQL 8 · Sanctum (personal access tokens) · Pest · Laravel Pint · Scramble or Spectator for OpenAPI.

### 6.2 Layering — thin controllers, explicit actions
```
app/
  Http/Controllers/Api/V1/    # HTTP only: validate → call action → return resource
  Http/Requests/              # FormRequest validation
  Http/Resources/             # response shaping (never expose raw models)
  Http/Middleware/            # auth, branch scope, idempotency, device heartbeat
  Actions/                    # one class per business operation
    Sales/CompleteSaleAction.php, VoidOrderAction.php, RefundOrderAction.php
    Inventory/RecordStockMovementAction.php, AdjustStockAction.php
    Shifts/OpenShiftAction.php, CloseShiftAction.php
    Sync/IngestOrdersAction.php, BuildChangeSetAction.php
  Policies/                   # one per resource, enforced on EVERY mutation
  Models/
  Support/Money.php           # integer-centavos value object
```
Business rules live in Actions and are unit-testable without HTTP. Controllers never contain money or stock logic.

### 6.3 Endpoint map (v1)
```
POST   /api/v1/auth/login                 email+password+device_code → token
POST   /api/v1/auth/pin                   fast cashier switch on a registered device
POST   /api/v1/auth/logout
GET    /api/v1/auth/me                    identity + role + branch + permissions[]

GET    /api/v1/sync/changes?since=<cursor>   delta pull: catalogue, users, printers, settings, tombstones
POST   /api/v1/sync/orders                   batch ingest (array), per-item result

GET    /api/v1/categories
GET    /api/v1/products                   ?category_id&search&cursor
GET    /api/v1/customers                  ?search&cursor
POST   /api/v1/customers

POST   /api/v1/orders                     single sale (online path); Idempotency-Key required
GET    /api/v1/orders                     ?from&to&status&cashier&cursor
GET    /api/v1/orders/{ulid}
POST   /api/v1/orders/{ulid}/void
POST   /api/v1/orders/{ulid}/refund

POST   /api/v1/shifts/open
POST   /api/v1/shifts/{id}/close
GET    /api/v1/shifts/{id}/x-read
GET    /api/v1/shifts/{id}/z-read

GET    /api/v1/reports/dashboard          ?from&to&branch_id → pre-aggregated scalars + daily series
GET    /api/v1/reports/sales              ?group_by=day|product|category|payment|cashier
GET    /api/v1/reports/inventory

# admin
CRUD   /api/v1/admin/{products|categories|users|printers|settings}
```

### 6.4 Conventions
- **Cursor pagination everywhere**, hard max page size 100. No endpoint returns an unbounded table (a severe legacy defect — order history returned every order ever, forever).
- Resources return **absolute** image URLs (`image_url`) plus `image_path`. React Native has no document base URL; relative `storage/...` paths are unusable.
- Consistent envelope: `{ data, meta }` on success; on error `{ message, errors{}, code }` with proper status codes. Never flash-message-style strings.
- All list endpoints support `updated_since` for delta sync and return tombstones for deletions.

### 6.5 Auth & RBAC
- **Sanctum personal access tokens**, bound to a registered `device`, with expiry and per-device revocation. Stored client-side in `expo-secure-store`.
- **PIN quick-switch**: one device, many cashiers. A short PIN re-authenticates an already-provisioned user within a device session without a full login.
- **Permissions are data**, not hardcoded ids (legacy compared `role_id === 2` in React). `/auth/me` returns a `permissions[]` array; the client uses it **only** to hide UI. Authority is always server-side.
- Every mutating endpoint calls `authorize()`. Suggested permission slugs: `sale.create`, `sale.void`, `sale.refund`, `discount.apply`, `discount.override`, `shift.open`, `shift.close`, `product.manage`, `user.manage`, `report.view`, `report.zread`, `purchase.approve` (v2), `inventory.adjust`.
- **Branch scoping middleware** injects `branch_id` from the authenticated user into every scoped query. `branch_id` is **never** accepted from request input for scoping. A `branch.all` permission allows an explicit override for owners.
- No public registration. Admin invite only.

### 6.6 Idempotency & transaction integrity
- `Idempotency-Key` header required on every mutating endpoint; for orders the key is the order's ULID.
- The key is recorded with its response. A replay returns the **original** response, never a duplicate side effect. This is what makes offline retry safe.
- `CompleteSaleAction` runs in one DB transaction: allocate invoice number (row-locked sequence) → insert order, items, payments → write stock movements → update `stock_levels` with `lockForUpdate` on affected rows. Any failure rolls the whole thing back.
- Printing **never** participates in the transaction.

### 6.7 Security
Rate-limit auth endpoints. Strong password policy (legacy used the 8-character default). Full audit log on every financial mutation. No secrets in responses. Force HTTPS. Validate image uploads by MIME and size; store on S3-compatible object storage, not a `public/` symlink (which legacy never even created — images 404'd).

---

## 7. React Native Architecture

### 7.1 Stack
Expo (SDK latest) · **Expo Dev Client / EAS Build — NOT Expo Go** (native TCP + SQLite modules) · TypeScript strict · Expo Router · TanStack Query · Zustand · `expo-sqlite` + Drizzle ORM · `expo-secure-store` · `react-native-tcp-socket` · `esc-pos-encoder`.

### 7.2 Structure
```
app/                          # Expo Router routes
  (auth)/login.tsx, pin.tsx
  (pos)/index.tsx             # menu grid + cart (primary screen)
  (pos)/checkout.tsx
  (pos)/orders/index.tsx, [ulid].tsx
  (pos)/shift/open.tsx, close.tsx
  (admin)/products, users, printers, reports
src/
  api/          # typed client, generated from OpenAPI
  db/           # Drizzle schema, migrations, queries
  sync/         # outbox, puller, reconciler, conflict rules
  printing/     # escpos builders, transport, queue, routing
  features/     # cart, orders, shifts, catalogue (hooks + logic)
  stores/       # Zustand: cart, session, device, connectivity
  money/        # centavos helpers — NO float arithmetic anywhere
```

### 7.3 State management
| Concern | Tool | Why |
|---|---|---|
| Cart, session, device config, connectivity | **Zustand** | Synchronous, simple, no server round-trip |
| Server data (catalogue, reports, history) | **TanStack Query** | Caching, background refetch, mutations |
| Durable local data (orders, outbox, stock cache, catalogue) | **SQLite (Drizzle)** | Survives restart; the offline source of truth |
| Auth token | **expo-secure-store** | Encrypted at rest |

Rule: **SQLite is the source of truth on-device.** TanStack Query caches reads; it never owns unsynced writes.

### 7.4 UX principles
Large tap targets (counter use, possibly gloved). Cart always visible in landscape — never hidden behind a breakpoint (a real legacy bug hid the entire cart below 1024px, making the POS unusable on the very tablets it targets). Optimistic UI with explicit sync state. A permanent, unmissable offline/pending indicator. Destructive actions (void, refund, shift close) require confirmation plus authorization.

---

## 8. Offline / Sync Strategy

### 8.1 Governing principle
**Classify every piece of data by direction of authority.** This removes nearly all conflict complexity:

| Class | Examples | Authority | Direction |
|---|---|---|---|
| **Reference** | products, categories, prices, users, printers, settings | **Server** | Pull only |
| **Events** | orders, payments, refunds, stock movements, shifts | **Client** (immutable facts) | Push only |
| **Derived** | stock levels, reports | **Server** | Pull (client keeps an advisory cache) |

Events are append-only and carry a client-generated ULID, so **two devices can never conflict** — they simply produce different events. Reference data is never edited on the device in v1, so there is nothing to merge.

### 8.2 Identity
Every event gets a **ULID generated on-device at creation time**. It is the primary identity, the idempotency key, and the deduplication key. No client ever waits for a server id.

### 8.3 Push (outbox)
Local table `outbox(id, ulid, entity, payload, created_at, attempts, last_error, status)`.
- Every local write that must reach the server enqueues here **in the same SQLite transaction** as the domain write. No lost writes.
- Worker drains **FIFO**, batched (≤50), with exponential backoff (1s → 60s cap) and jitter. Triggered on: connectivity regained, app foreground, successful login, and a periodic timer.
- Server responds per item: `accepted` | `duplicate` (already ingested — treat as success) | `rejected` (with reason).
- `rejected` is the only interesting case: the item moves to a `needs_review` state surfaced to a manager. It is never silently dropped.

### 8.4 Pull (delta)
`GET /sync/changes?since=<cursor>` returns changed reference rows plus tombstones and a new cursor. Applied in one SQLite transaction. Full re-baseline available for a new device or a corrupted local DB.

### 8.5 Offline numbering
`order_no` is generated locally as `{DEVICE}-{YYYYMMDD}-{seq}` from a per-device counter — unique without coordination, and **printed on the receipt immediately**. The server assigns the canonical `invoice_no` at ingest and returns it; the client stores both. Receipts printed offline show `order_no`; if the business requires the fiscal invoice number on the physical receipt, the sale must be online-only — **flag this for confirmation with the client's accountant.**

### 8.6 Offline stock
The device keeps an advisory stock cache. Offline sales decrement it locally and warn when it would go negative, but **never block**. The server applies movements truthfully at ingest, permitting negative stock and flagging oversells in an exceptions report. Rationale: an offline sale has already physically occurred; refusing it at sync would create books that contradict the cash drawer.

### 8.7 Conflicts
- Order vs order: impossible (unique ULIDs, append-only).
- Price changed during an outage: the sale keeps its **snapshotted** price; the server records `has_total_mismatch` for manager review rather than rewriting the receipt the customer already holds.
- Product deleted during an outage: the sale is still accepted; the line's snapshot preserves what was sold.
- Reference data edited on two devices: cannot happen in v1 (pull-only).

### 8.8 Sync UX states
`synced` · `pending (N)` · `syncing` · `needs review (N)` · `offline`. Always visible in the header. Tapping opens a queue detail screen with a manual "Sync now" and per-item errors.

---

## 9. Printing Architecture

### 9.1 Decision
**The tablet prints directly to network thermal printers over TCP port 9100 (raw ESC/POS).** No print server, no queue table, no local PC bridge, no polling agent.

This is possible *because* the client is now a native app. The legacy system was a browser app, which cannot open a raw socket — which is precisely why it needed a PC-based bridge and why printing broke the moment the backend moved to a VPS.

### 9.2 Why this is correct here
- The printer and the tablet are on the same store LAN. The backend's hosting location becomes **irrelevant** to printing.
- Printing works fully offline — the sale, the receipt, and the kitchen ticket need no internet at all.
- No always-on PC to maintain, no single point of failure, no VPN or tunnel.

### 9.3 How it works
1. Sale completes locally → a print job is built from local data.
2. `esc-pos-encoder` renders the ESC/POS byte stream (58/80mm aware).
3. `react-native-tcp-socket` connects to `printer.host:9100`, writes, waits for drain, closes.
4. Outcome recorded locally per job; kitchen-ticket deltas update `order_item_prints.sent_qty` **only for the printer that actually succeeded**.

### 9.4 Configuration & routing
Printers are configured server-side (`printers` table) and synced to the device, with a local override for a printer's IP so a device can be repointed without a server round-trip. `print_routes` maps category → printer (food → kitchen, drinks → bar); unmapped categories fall back to the branch default. A **"Test print"** action per printer is a first-class feature — the legacy system's single hardest problem was not knowing which printer IP was actually correct.

### 9.5 Reliability
- Local print queue with retry (3 attempts, exponential backoff) and a 5-second connect timeout.
- **A print failure never blocks or reverses a sale.** It raises a clear, actionable banner: "Kitchen ticket failed — printer offline. [Retry] [Reprint]".
- Every order is reprintable from order history, indefinitely.
- Printer reachability is checked on shift open and surfaced before service begins, not at the first sale.

### 9.6 Deferred
Bluetooth transport (for printers out of WiFi range, ~10m limit) and a server-side bridge (for printing triggered by a device not on the store LAN, e.g. online orders) are both **v3**, and the printing layer is abstracted behind a `PrintTransport` interface so either can be added without touching receipt-building code.

---

## 10. Development Roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0. Foundations** | Repos, CI, Docker/local env, schema migrations, seeders, Sanctum auth, roles/permissions, policies, OpenAPI, **isolated test DB** | A cashier and an admin can log in; a policy denies a forbidden action; `pest` and `jest` green in CI |
| **1. Catalogue & admin API** | Categories, products, customers, users, printers, settings; cursor pagination; image upload to object storage | Admin CRUD fully usable via API with authorization enforced and paginated responses |
| **2. RN shell** | Expo Router app, dev-client build, login + PIN, secure token storage, SQLite + Drizzle, delta pull of catalogue | App installs on the tablet, logs in, browses the real menu offline after one sync |
| **3. Core sale (online)** | Local cart, checkout, split payments, discounts, VAT, `CompleteSaleAction`, stock movements, idempotency | A sale completes, totals are server-computed, stock moves, a replayed request creates no duplicate |
| **4. Printing** | ESC/POS builders, TCP transport, routing, kitchen deltas, retry, test print, reprint | Receipt and kitchen ticket print reliably from the tablet; a dead printer never loses a sale |
| **5. Offline-first** | Outbox, sync worker, delta pull, offline numbering, advisory stock, sync UX, review queue | **Airplane-mode acceptance test**: 20 sales offline, all print, all reconcile on reconnect, zero duplicates, zero losses |
| **6. Shifts & reporting** | Open/close, cash variance, X/Z read, dashboard + sales reports (SQL-aggregated) | A shift closes with a correct variance; dashboard responds <500ms on a year of seeded data |
| **7. Voids & refunds** | Void, full/partial refund, authorization, reversing movements, audit log | Stock and revenue reconcile exactly after a void and a partial refund |
| **8. Hardening & pilot** | Load/soak test, crash reporting, backup/restore, device provisioning, staff training | Runs a full real service day with no data loss |
| **v2** | Ingredients, recipes, enforced unit conversion, suppliers, PR → PO → goods receipt, weighted-average costing | Ingredient stock depletes on sale; a receipt updates cost correctly in the stocking unit |
| **v3** | Multi-branch activation, Bluetooth printing, server-side print bridge, loyalty | — |

**Testing baseline (non-negotiable):**
- Backend: Pest feature tests per endpoint against an **isolated** database (the legacy `phpunit.xml` pointed at the live production DB with `RefreshDatabase` — a latent catastrophe). Required suites: money computation, discount limits, idempotency/replay, stock ledger correctness, void/refund reversal, RBAC denial, branch isolation.
- Client: Jest + RNTL for hooks and components; dedicated unit tests for the **sync engine** and **ESC/POS builders**; Maestro E2E for the sale happy path and the offline→reconnect scenario.

---

## 11. Key Technical Decisions

| # | Decision | Rationale | Alternative rejected |
|---|---|---|---|
| 1 | Money as integer centavos everywhere | Eliminates float error across PHP/JS/SQLite | Decimal strings — error-prone in JS |
| 2 | Server recomputes all money; client total is a checksum | Legacy trusted the client entirely — the single worst defect found | Trusting a signed client payload |
| 3 | Client-generated ULIDs as idempotency keys | Offline creation without server round-trips; makes retry safe | Server ids (impossible offline); UUIDv4 (no ordering) |
| 4 | Append-only `stock_movements` + cached levels | Auditability, COGS, offline reconciliation | Mutating a qty column (legacy — unreconcilable) |
| 5 | Cart is client-only state | Legacy's shared server cart let cashiers overwrite each other | A server cart/ticket table |
| 6 | Events push / reference pulls | Removes essentially all sync conflicts by construction | Bidirectional sync with LWW or CRDTs — unjustified complexity |
| 7 | Offline sales are never rejected for stock | The money already changed hands | Rejecting at sync — books contradict the drawer |
| 8 | Direct TCP printing from the tablet | Native app removes the browser limitation that forced a PC bridge | Print-agent bridge (built for legacy; a maintenance burden and a single point of failure) |
| 9 | Sanctum PATs + device binding + PIN switch | Mobile-appropriate; matches one-tablet-many-cashiers reality | Session cookies (unusable in RN) |
| 10 | Permissions as data, enforced by policies | Legacy hardcoded `role_id === 2` in React with zero server checks | Role-name string checks |
| 11 | Branch id derived from the token, never from input | Legacy accepted `branch_id` from the request body | Trusting client-supplied scope |
| 12 | Denormalised snapshots on order lines | Master-data edits must never rewrite financial history | Joining to live products (legacy) |
| 13 | Expo **Dev Client**, not Expo Go | TCP sockets and SQLite are native modules | Expo Go — cannot print, non-negotiable blocker |
| 14 | Cursor pagination with a hard cap | Legacy returned every order ever created on one screen | Offset pagination; unbounded `get()` |
| 15 | Business day = branch timezone + configurable start | Legacy ran UTC, so the day rolled at 08:00 local, mid-service | Server-local midnight |
| 16 | Absolute image URLs from object storage | RN has no base URL; legacy's `public/storage` symlink never existed | Relative paths + symlink |
| 17 | Unit conversion enforced server-side (v2) | Legacy applied it once in the browser; receiving corrupted stock silently | Client-side conversion |
| 18 | Isolated test database | Legacy tests ran `RefreshDatabase` against production data | Sharing the dev/prod DB |

---

## Appendix A — Legacy System Reference

### A.1 Modules (what it did)
Dashboard · POS/Menu (cart + checkout) · Order history · Categories · Products (with ingredient recipes) · Ingredients (+ unit conversions) · Customers · Suppliers · Purchasing (PR → PO → receiving) · Users · Printing (receipt + kitchen).

### A.2 Legacy data model (reference)
`tbl_`-prefixed tables with per-table custom primary keys (`od_id`, `pd_id`, `cat_id`, `ing_id`, `ct_id`, …). `tbl_order` ← `tbl_order_items` → `tbl_product` → `tbl_category`; `tbl_product_ingredient` pivot → `tbl_ingredient`; `tbl_order_item_ingredients` snapshotted per-sale ingredient consumption; `tbl_cart` a single global cart; purchasing across `tbl_purchase_request(_items)` and `tbl_purchase_order(_items)`; `users` → `tr_role`, `tbl_branch`.

### A.3 Defects — the do-not-inherit list

**Financial integrity**
1. Server never recomputed any total, discount, or unit price — all taken verbatim from the client.
2. No check that payment ≥ total, or that discount ≤ subtotal.
3. `invoice_no` and `queue_no` had no unique index; both derived from `COUNT(*)`, reusable after deletion.
4. `percent_discount` and `other_charges` hardcoded to 0 — dead columns posing as features.
5. No tax/VAT model at all; no SC/PWD discount typing; no Z-read. Not BIR-compliant.

**Inventory**
6. Finished-goods stock never validated at checkout — unlimited overselling.
7. Stock validation was per-line, so two lines of the same product each passed against full stock.
8. Overdraws silently clamped by `max(0, …)`; the consumption snapshot recorded the *requested*, not actual, amount — unreconcilable.
9. Stock status was a free-text column written by three code paths with three different vocabularies; goods receipt never updated it at all, so restocked items stayed "Out of Stock".
10. Unit conversion existed but was applied **once, in the browser**, at recipe entry. Receiving added raw quantities across units (ordering "1 box" added 1 to a gram-based level) and blended the price into average cost unconverted.
11. No void, refund, or cancel anywhere. The only way to reverse a sale was deleting the row, which cascaded its line items away and restored no stock.

**Access control**
12. **Zero server-side authorization.** Any authenticated user could create admins, delete records, and approve purchase orders. The only "checks" were React components hiding buttons based on `role_id === 2`.
13. Public self-registration created a working, auto-logged-in account.
14. `branch_id` was written but **never used as a filter** anywhere — total data-isolation failure the moment a second branch exists.
15. No `created_by`/`updated_by` on any table; no audit log.

**Architecture & scale**
16. Order history and the customer list returned **every row, forever**, unpaginated.
17. The dashboard hydrated 90 days of orders + items + products into PHP, then recomputed the charts in JavaScript on the full array (`Math.max(...spread)` — a stack overflow at scale). Two mutually inconsistent revenue definitions on one screen.
18. One global shared cart with no user scoping; checkout deleted it for everyone and never reconciled it against what was actually sold.
19. Soft deletes applied inconsistently (columns without traits), no restore UI, and `CASCADE` foreign keys that bypass them — deleting a customer would erase their entire order history.
20. Images stored as relative paths, built into URLs inconsistently across components, orphaned on delete, and the `public/storage` symlink was never created.
21. Flash messages were used in ~12 controllers but never actually shared to the frontend — the plumbing was dead code.
22. `phpunit.xml` pointed the test suite at the **live production database**, with Breeze tests using `RefreshDatabase`.
23. Printing was synchronous inside the HTTP request, hardcoded to LAN IPs — guaranteed to fail once the backend was hosted remotely, which is exactly what happened.

---

## Verification (how we know the new system is correct)

1. **Money:** property-based tests asserting `subtotal − discount + vat == total` and that a tampered client total is recorded but never honoured.
2. **Idempotency:** replay the same order ULID 50× concurrently → exactly one order, one set of stock movements.
3. **Offline:** airplane-mode acceptance run — 20 sales offline, all printed, reconnect, all reconcile, zero duplicates, zero losses.
4. **Stock:** `SUM(stock_movements.qty_delta) == stock_levels.qty` after a randomised sequence of sales, voids, refunds, and adjustments.
5. **RBAC:** for every mutating endpoint, a test asserting an under-privileged role receives 403.
6. **Branch isolation:** seed two branches; assert no endpoint leaks the other branch's data.
7. **Printing:** integration test against a local TCP listener asserting correct ESC/POS bytes; a dead-printer test asserting the sale still completes.
8. **Scale:** seed a year of orders; every list and report endpoint responds <500ms and returns bounded payloads.
