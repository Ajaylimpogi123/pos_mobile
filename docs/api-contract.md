# API Contract

**Single source of truth** between `backend-agent` (Laravel API) and `frontend-agent` (Expo app in `mobile/`).

- The **main session** drafts and edits this file. The user approves each feature section before any code is written.
- Agents may only **append** to [Open Questions](#open-questions). Everything else is read-only to them.
- Where this contract and `PROJECT_MEMORY.md` disagree on an API shape, **this contract wins**. Raise an Open Question if the disagreement looks unintended.

| Contract version | Last updated | Approved features |
|---|---|---|
| 1.19 | 2026-09-29 | Auth (Phase 0, rev 2) · Catalogue (1a) · Staff & Customers (1b, rev 2) · Dashboard (1c) · Catalogue Sync (2) · Core Sale (3) · Printing (4) · Table Number (Core Sale rev 2) · Offline Sales (5) · Shifts & Reporting (6) · Voids & Refunds (7) · Inventory (v1 completion) · SC/PWD Discount · Ingredients, Recipes & Purchasing |

---

## Global Conventions

These apply to every endpoint unless a feature section says otherwise.

### Base URL
- The app reads `EXPO_PUBLIC_API_URL`, which is the server **origin** with no trailing slash, e.g. `http://192.168.1.50:8000`. It is never `localhost`.
- Every URI below is a full path starting with `/api/v1/`.
- Route names use the `v1.` prefix, e.g. `v1.auth.login`.

### Request headers
| Header | When | Value |
|---|---|---|
| `Accept` | Every request | `application/json` |
| `Content-Type` | Requests with a body | `application/json` |
| `Authorization` | Endpoints marked **Auth: yes** | `Bearer <sanctum-token>` |
| `Idempotency-Key` | Endpoints marked **Idempotent: yes** | A client-generated ULID (26 characters) |

### Data types
| Kind | JSON representation | Example |
|---|---|---|
| Money | integer centavos, field suffixed `_cents` | `"total_cents": 125050` = ₱1,250.50 |
| Date-time | ISO 8601 UTC string | `"2026-09-24T03:15:00Z"` |
| Date (business day) | `YYYY-MM-DD` | `"2026-09-24"` |
| Internal id | integer | `"id": 12` |
| Transactional id | ULID string | `"ulid": "01J8Z3K5Q9V7X2M4N6P8R0T1W3"` |
| Boolean | `true` / `false` | never `0` / `1` |
| Nullable field | always present, value `null` | never omitted |

### Success: single resource
HTTP `200` (read or update) or `201` (create):
```json
{ "data": { "id": 1, "...": "..." } }
```
HTTP `204` has no body. Use it only where a feature section says so.

### Create, update, delete (admin CRUD pattern)
- **Create:** `POST` with a JSON body. Returns `201` with `{ "data": <resource> }`.
- **Update:** `PATCH` with **partial** semantics: only the fields sent are validated and changed, and omitted fields stay as they are. Sending `null` to a nullable field clears it. Returns `200` with `{ "data": <resource> }`.
- **Delete:** `DELETE`, a **soft delete** for master data. Returns `204` with no body. A soft-deleted record then returns `404` everywhere.
- Every create, update and delete writes an audit log entry (`<entity>.created|updated|deleted`, with the changed fields).

### File uploads
- Images are uploaded **separately from JSON**, as `multipart/form-data` with a single file field `image`, to the endpoint the feature defines. `Content-Type` is the multipart boundary type, not JSON. `Accept: application/json` still applies.
- Allowed types: `jpeg`, `png`, `webp`. Max **5 MB**. Min 100×100 px. The client should downscale to about 1024 px on the long edge before upload.
- Responses always carry both `image_url` (an **absolute** URL the app can load directly, or `null`) and `image_path` (a storage-relative path, or `null`).

### Conflict
| Status | When | Body |
|---|---|---|
| `409` | The request is valid but conflicts with current data (e.g. deleting a category that still has products) | `{ "message": "<human-readable reason defined by the feature>" }` |

### Idempotent requests
*(Added in Phase 3.)* This applies to every endpoint marked **Idempotent: yes**.
- The client sends an `Idempotency-Key` header containing a ULID it generated. When the body has a `ulid` field, the header **must equal** it.
- A missing or malformed header, or one that doesn't match `ulid`, returns `422` with `errors.idempotency_key`: `The Idempotency-Key header must be a ULID that matches the request's ulid.`
- The server stores the key together with the response of the **first successful (2xx)** request. A later request with the same key, the same endpoint and the same body gets the **stored status and body** again, with the header `Idempotency-Replayed: true`, and nothing is written a second time.
- The same key with a **different** endpoint or body returns `409 { "message": "This Idempotency-Key was already used for a different request." }`.
- The same key sent while the first request is **still running** returns `409 { "message": "This request is still being processed. Try again in a moment." }`.
- A request that **fails** (any 4xx or 5xx) does **not** use up the key. The client may correct the request and send it again with the same key.
- Bodies are compared as decoded JSON, ignoring key order and any `pin` field. PINs are never stored.
- The replay check runs after authentication and **before** validation.
- **Client rule:** generate the key once per logical action (for example, once per sale), reuse it on **every** retry until the request succeeds, and only then generate a new one. After a network error or a timeout, always retry with the **same** key, because the first attempt may have succeeded.

### Success: paginated list (cursor)
HTTP `200`. `per_page` defaults to 25 and has a hard maximum of 100. Pass the cursor back as `?cursor=<next_cursor>`. `next_cursor: null` means this is the last page.
```json
{
  "data": [ { "id": 1, "...": "..." } ],
  "links": {
    "first": null,
    "last": null,
    "prev": null,
    "next": "http://192.168.1.50:8000/api/v1/products?cursor=eyJpZCI6MjUsIl9wb2ludHNUb05leHRJdGVtcyI6dHJ1ZX0"
  },
  "meta": {
    "path": "http://192.168.1.50:8000/api/v1/products",
    "per_page": 25,
    "next_cursor": "eyJpZCI6MjUsIl9wb2ludHNUb05leHRJdGVtcyI6dHJ1ZX0",
    "prev_cursor": null
  }
}
```
This is Laravel's default output for `Resource::collection($query->cursorPaginate($perPage))`. The frontend relies on `data` and `meta.next_cursor` only.

### Errors
All errors are JSON, even when the `Accept` header is missing.

| Status | When | Body |
|---|---|---|
| `401` | Missing, invalid, or expired token | `{ "message": "Unauthenticated." }` *(exception: failed credentials on `POST /api/v1/auth/login`, see that endpoint)* |
| `403` | Authenticated but not permitted | `{ "message": "This action is unauthorized." }` *(a feature may define a more specific message)* |
| `404` | Resource or route not found | `{ "message": "Resource not found." }` |
| `422` | Validation failed | see below |
| `429` | Rate limited | `{ "message": "Too Many Attempts." }` |
| `500` | Server error | `{ "message": "Server Error." }` |

`422` uses Laravel's default shape. `errors` maps each field name (dot notation for nested or array fields) to an array of messages:
```json
{
  "message": "The email field is required. (and 1 more error)",
  "errors": {
    "email": ["The email field is required."],
    "password": ["The password field must be at least 8 characters."]
  }
}
```

Client behaviour:
- **401** on an authenticated request: clear the token and go to login. (A `401` from login itself is a form error.)
- **422**: show each message under its field.
- **Any other error**: show `message`.

---

## Features

*No features approved yet.* Each feature is added below using this template:

```
## Feature: <Name>
Status: DRAFT | APPROVED (YYYY-MM-DD)

### <METHOD> /api/v1/<path>
| | |
|---|---|
| Route name | v1.<name> |
| Controller | Api\V1\<Controller>@<method> |
| Auth | yes / no (permission: <slug>) |
| Idempotent | yes / no |

**Query params:** name | type | required | rules | notes
**Body fields:** name | type | required | validation rules | notes

**200/201 response:** exact JSON example + field table (name | type | nullable | notes)
**Errors:** each status this endpoint can return, with the exact body where it differs from Global Conventions
```

---

## Feature: Auth & Access Control (Phase 0)
Status: **APPROVED** (2026-09-24) · **Revision 2: APPROVED** (2026-09-24) (removes the device from login; login failures change to 401/403)

Staff log in with **email + password only** and receive a Sanctum token named `mobile-app`. The app uses `/auth/me` to learn who is logged in and what they may do. `permissions[]` is **only a UI hint**: the server enforces every permission itself.

*Revision 2:* tokens are **no longer bound to a device**. The `devices` table and `personal_access_tokens.device_id` column stay in the schema, unused, for later phases, but nothing in auth reads or writes them. Device identity will come back in the offline-numbering phase without cashier input (see PROJECT_MEMORY.md §8.5).

*Deferred:* PIN quick-switch (`POST /api/v1/auth/pin`) moves to **Phase 3** (changed from Phase 2 on 2026-09-24), where sales start and cashier attribution matters. It needs the device to sync the branch's user list first.

### Shared object: `AuthUser`
Returned by `login` (inside `data.user`) and by `me` (as `data`).

```json
{
  "id": 3,
  "name": "Carla Cashier",
  "email": "cashier@pos.test",
  "is_active": true,
  "last_login_at": "2026-09-24T01:30:00Z",
  "role": {
    "id": 3,
    "slug": "cashier",
    "name": "Cashier",
    "max_discount_percent": 10,
    "is_admin": false
  },
  "branch": {
    "id": 1,
    "code": "MAIN",
    "name": "Main Branch",
    "timezone": "Asia/Manila",
    "day_start_time": "04:00"
  },
  "permissions": ["discount.apply", "sale.create", "shift.close", "shift.open"]
}
```

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `name` | string | no | |
| `email` | string | no | |
| `is_active` | boolean | no | Always `true` here, because inactive users can't authenticate |
| `last_login_at` | date-time | **yes** | Time of the most recent successful login (in the `login` response, that is this login). `null` only for a user who has never logged in. |
| `role.id` | integer | no | |
| `role.slug` | string | no | Stable key: `owner`, `manager`, `cashier`. Never compare role ids. |
| `role.name` | string | no | Display name |
| `role.max_discount_percent` | integer 0–100 | no | Max order discount the user may give without a manager override |
| `role.is_admin` | boolean | no | UI hint: show the admin area |
| `branch.id` | integer | no | |
| `branch.code` | string | no | |
| `branch.name` | string | no | |
| `branch.timezone` | string | no | IANA zone, e.g. `Asia/Manila` |
| `branch.day_start_time` | string `HH:MM` | no | Business day rollover, local time |
| `permissions` | string[] | no | Permission slugs, sorted A→Z, no duplicates. May be empty. |

### POST /api/v1/auth/login
| | |
|---|---|
| Route name | `v1.auth.login` |
| Controller | `Api\V1\AuthController@login` |
| Auth | no |
| Idempotent | no |
| Rate limit | 5 attempts per minute per `email` + IP, then `429` |

**Body fields**
| Name | Type | Required | Validation rules | Notes |
|---|---|---|---|---|
| `email` | string | yes | `required`, `string`, `email`, `max:255` | Case-insensitive match |
| `password` | string | yes | `required`, `string`, `max:255` | No strength rule on *login* |

No other fields. The server **ignores** any extra fields a client sends (e.g. a stale `device_code`); they never cause an error.

Checks run in this order, and the first failure wins:
| Check | Status | Body |
|---|---|---|
| Field validation fails | `422` | Laravel default `{ "message", "errors": { "email"?, "password"? } }` |
| Email not found, or wrong password | `401` | `{ "message": "Invalid email or password." }` |
| User is deactivated (the password was correct) | `403` | `{ "message": "This account has been deactivated." }` |

**On success**, the server:
- issues a new token named `mobile-app`, expiring after `AUTH_TOKEN_TTL_HOURS` (default **24**). Other tokens the user holds (e.g. on another phone) are **not** revoked.
- sets `users.last_login_at`
- writes an `auth.login` audit log entry

**200 response**
```json
{
  "data": {
    "token": "1|Xk9f2mQ7vR3tP8wZ1yB5nC6dE0aH4jL2sU7gK9oI",
    "token_type": "Bearer",
    "expires_at": "2026-09-25T01:30:00Z",
    "user": { "...": "AuthUser (see above)" }
  }
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `token` | string | no | Plain-text Sanctum token. Store it in `expo-secure-store`. It is never returned again. |
| `token_type` | string | no | Always `"Bearer"` |
| `expires_at` | date-time | no | The client may pre-emptively send the user to login after this time |
| `user` | `AuthUser` | no | |

**Errors:** `422`, `401`, `403` (see the table above) · `429` `{ "message": "Too Many Attempts." }`

**Client note:** this is the only endpoint where `401` does **not** mean "session expired". The app must show the message on the login form, not clear the session or redirect. The shared client already skips its 401 handler for unauthenticated calls (`auth: false`).

### GET /api/v1/auth/me
| | |
|---|---|
| Route name | `v1.auth.me` |
| Controller | `Api\V1\AuthController@me` |
| Auth | yes (any authenticated user) |
| Idempotent | n/a |

**200 response**
```json
{ "data": { "...": "AuthUser (see above)" } }
```

**Errors:** `401`. This covers a missing, invalid, expired or revoked token, **and** a token belonging to a user who was deactivated or soft-deleted after login. The server revokes such a token.

### POST /api/v1/auth/logout
| | |
|---|---|
| Route name | `v1.auth.logout` |
| Controller | `Api\V1\AuthController@logout` |
| Auth | yes |
| Idempotent | no |

No body. Revokes **only the current token**. Writes an `auth.logout` audit log entry.

**204 response:** no body.
**Errors:** `401`. The client treats a `401` from logout as success: it clears local state either way.

### GET /api/v1/admin/users
> **Extended in Phase 1b:** items gain `has_pin` and `can_manage`, and the endpoint gains `role_id` / `is_active` filters. See "Feature: Staff & Customers (Phase 1b)". The shape below is the Phase 0 original.

Proves Phase 0's exit criterion that a policy denies a forbidden action, and establishes the pagination pattern. It is **backend-only in Phase 0**: the app does not call it yet (the admin UI arrives in Phase 1).

| | |
|---|---|
| Route name | `v1.admin.users.index` |
| Controller | `Api\V1\Admin\UserController@index` |
| Auth | yes. Permission `user.manage` (via `UserPolicy@viewAny`). Without it: `403`. |
| Idempotent | n/a |

**Query params**
| Name | Type | Required | Rules | Notes |
|---|---|---|---|---|
| `per_page` | integer | no | `integer`, `min:1`, `max:100` | Default 25 |
| `cursor` | string | no | `string` | From `meta.next_cursor` |
| `search` | string | no | `string`, `max:100` | Case-insensitive "contains" match on `name` or `email` |

Scope: users in the **caller's branch** only; soft-deleted users are excluded; deactivated users are included. Ordered by `name` ascending, then `id` ascending.

**200 response** (cursor pagination envelope from Global Conventions):
```json
{
  "data": [
    {
      "id": 3,
      "name": "Carla Cashier",
      "email": "cashier@pos.test",
      "is_active": true,
      "last_login_at": null,
      "role": { "id": 3, "slug": "cashier", "name": "Cashier" },
      "created_at": "2026-09-24T01:00:00Z",
      "updated_at": "2026-09-24T01:00:00Z"
    }
  ],
  "links": { "first": null, "last": null, "prev": null, "next": null },
  "meta": { "path": "http://192.168.1.7:8000/api/v1/admin/users", "per_page": 25, "next_cursor": null, "prev_cursor": null }
}
```
| Field | Type | Nullable |
|---|---|---|
| `id` | integer | no |
| `name`, `email` | string | no |
| `is_active` | boolean | no |
| `last_login_at` | date-time | yes |
| `role.id` | integer | no |
| `role.slug`, `role.name` | string | no |
| `created_at`, `updated_at` | date-time | no |

**Errors:** `401` · `403` `{ "message": "This action is unauthorized." }` · `422` (invalid `per_page` or `search`)

### Roles & permissions (seeded; the same in every environment)
Permission slugs (13): `branch.all`, `discount.apply`, `discount.override`, `inventory.adjust`, `product.manage`, `report.view`, `report.zread`, `sale.create`, `sale.refund`, `sale.void`, `shift.close`, `shift.open`, `user.manage`.

| Role (`slug`) | `is_admin` | `max_discount_percent` | Permissions |
|---|---|---|---|
| Owner (`owner`) | true | 100 | all 13 |
| Manager (`manager`) | true | 100 | all except `branch.all` |
| Cashier (`cashier`) | false | 10 *(placeholder; confirm with the business owner)* | `sale.create`, `discount.apply`, `shift.open`, `shift.close` |

### Dev seed data (local environment only; never seeded in production)
| Kind | Values |
|---|---|
| Branch | `MAIN`, "Main Branch", `Asia/Manila`, day start `04:00` |
| Device | `TAB01`, "Counter Tablet 1", branch `MAIN` *(still seeded for later phases; not used by auth since revision 2)* |
| Users (password `password`) | `owner@pos.test` (Owner) · `manager@pos.test` (Manager) · `cashier@pos.test` (Cashier) · `inactive@pos.test` (Cashier, deactivated) |

---

## Feature: Catalogue: Categories & Products (Phase 1a)
Status: **APPROVED** (2026-09-24)

The menu. **Read endpoints** serve any logged-in user (the POS screens). **Admin endpoints** (`/admin/...`) manage the menu and require the `product.manage` permission; without it they return `403`. Categories and products are **global master data**, shared by all branches and not branch-scoped. Stock levels are **not** part of this slice: they arrive with the sale flow (Phase 3), where the stock ledger is built.

### Shared object: `Category`
```json
{
  "id": 2,
  "name": "Breakfast",
  "description": "Served until 11 AM",
  "sort_order": 10,
  "is_active": true,
  "products_count": 3,
  "image_url": "http://192.168.1.7:8000/storage/categories/2/9f1c2a.webp",
  "image_path": "categories/2/9f1c2a.webp",
  "created_at": "2026-09-24T01:00:00Z",
  "updated_at": "2026-09-24T01:00:00Z"
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `name` | string | no | Unique among non-deleted categories (case-insensitive) |
| `description` | string | yes | |
| `sort_order` | integer | no | Ascending order on menus |
| `is_active` | boolean | no | Inactive categories are hidden from the POS read endpoints |
| `products_count` | integer | no | **Read endpoint:** products in the category that are available (`is_available = true`). **Admin endpoints:** all non-deleted products in the category. |
| `image_url` | string (absolute URL) | yes | |
| `image_path` | string | yes | |
| `created_at`, `updated_at` | date-time | no | |

### Shared object: `Product`
```json
{
  "id": 7,
  "category": { "id": 2, "name": "Breakfast" },
  "sku": "BRK-001",
  "name": "Egg with Rice",
  "description": "Two fried eggs, garlic rice",
  "price_cents": 5000,
  "cost_cents": 2200,
  "is_vatable": true,
  "is_available": true,
  "track_stock": false,
  "sort_order": 0,
  "image_url": null,
  "image_path": null,
  "created_at": "2026-09-24T01:00:00Z",
  "updated_at": "2026-09-24T01:00:00Z"
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `category.id`, `category.name` | integer, string | no | |
| `sku` | string | yes | Unique among non-deleted products (case-insensitive) when present |
| `name` | string | no | |
| `description` | string | yes | |
| `price_cents` | integer | no | Selling price in centavos, VAT-inclusive |
| `cost_cents` | integer | no | **Admin endpoints only.** The key is **absent** from the read endpoint (the one deliberate exception to "keys always present", because cashiers must not see cost). |
| `is_vatable` | boolean | no | `false` = VAT-exempt item |
| `is_available` | boolean | no | `false` = shown as "Unavailable" and cannot be sold |
| `track_stock` | boolean | no | Whether sales deplete stock (used from Phase 3) |
| `sort_order` | integer | no | |
| `image_url` | string (absolute URL) | yes | |
| `image_path` | string | yes | |
| `created_at`, `updated_at` | date-time | no | |

### Read endpoints (any authenticated user)

#### GET /api/v1/categories
| | |
|---|---|
| Route name | `v1.categories.index` |
| Controller | `Api\V1\CategoryController@index` |
| Auth | yes (any user) |

**Query params:** `per_page` (integer, `min:1`, `max:100`, default 100) · `cursor` (string)
Returns **active**, non-deleted categories only, ordered by `sort_order`, then `name`, then `id`. Uses the cursor pagination envelope, with `Category` items (`products_count` counts only available products).
**Errors:** `401` · `422`

#### GET /api/v1/products
| | |
|---|---|
| Route name | `v1.products.index` |
| Controller | `Api\V1\ProductController@index` |
| Auth | yes (any user) |

**Query params**
| Name | Type | Required | Rules | Notes |
|---|---|---|---|---|
| `per_page` | integer | no | `integer`, `min:1`, `max:100` | Default 50 |
| `cursor` | string | no | `string` | |
| `category_id` | integer | no | `integer` | Filter to one category. An unknown or inactive id returns an empty list, not an error. |
| `search` | string | no | `string`, `max:100` | Case-insensitive "contains" on `name` or `sku` |

Returns non-deleted products whose category is active and non-deleted, **including unavailable ones** (the POS shows them greyed out). Ordered by `sort_order`, then `name`, then `id`. Uses the cursor pagination envelope, with `Product` items **without `cost_cents`**.
**Errors:** `401` · `422`

### Admin: categories (permission `product.manage`)

| Method | URI | Route name | Controller | Success |
|---|---|---|---|---|
| GET | `/api/v1/admin/categories` | `v1.admin.categories.index` | `Api\V1\Admin\CategoryController@index` | 200, paginated |
| POST | `/api/v1/admin/categories` | `v1.admin.categories.store` | `…@store` | 201 `{data: Category}` |
| GET | `/api/v1/admin/categories/{id}` | `v1.admin.categories.show` | `…@show` | 200 `{data: Category}` |
| PATCH | `/api/v1/admin/categories/{id}` | `v1.admin.categories.update` | `…@update` | 200 `{data: Category}` |
| DELETE | `/api/v1/admin/categories/{id}` | `v1.admin.categories.destroy` | `…@destroy` | 204 |
| POST | `/api/v1/admin/categories/{id}/image` | `v1.admin.categories.image.store` | `…@storeImage` | 200 `{data: Category}` |
| DELETE | `/api/v1/admin/categories/{id}/image` | `v1.admin.categories.image.destroy` | `…@destroyImage` | 200 `{data: Category}` |

**Index query params:** `per_page` (1–100, default 25) · `cursor` · `search` (`max:100`, contains on `name`) · `is_active` (`boolean`, optional filter). Includes inactive categories; excludes soft-deleted ones. Ordered by `sort_order`, then `name`, then `id`. `products_count` counts all non-deleted products.

**Body fields (store / update)**
| Name | Type | Store | Update | Validation rules |
|---|---|---|---|---|
| `name` | string | required | sometimes | `string`, `max:80`, unique (case-insensitive) among non-deleted categories, ignoring itself on update |
| `description` | string\|null | optional | sometimes | `nullable`, `string`, `max:255` |
| `sort_order` | integer | optional (default 0) | sometimes | `integer`, `min:0`, `max:65535` |
| `is_active` | boolean | optional (default `true`) | sometimes | `boolean` |

**Delete rule:** a category that still has any non-deleted product returns **`409 { "message": "This category still has products. Move or delete them first." }`**. Deleting its image file is not required on soft delete.

**Image upload:** multipart field `image` (see Global Conventions → File uploads). This replaces any existing image, and the old file is deleted from storage. `DELETE …/image` clears `image_url`/`image_path` and deletes the file.

**Errors (all admin category endpoints):** `401` · `403` · `404` (unknown or soft-deleted id) · `409` (delete) · `422`

### Admin: products (permission `product.manage`)

| Method | URI | Route name | Controller | Success |
|---|---|---|---|---|
| GET | `/api/v1/admin/products` | `v1.admin.products.index` | `Api\V1\Admin\ProductController@index` | 200, paginated |
| POST | `/api/v1/admin/products` | `v1.admin.products.store` | `…@store` | 201 `{data: Product}` |
| GET | `/api/v1/admin/products/{id}` | `v1.admin.products.show` | `…@show` | 200 `{data: Product}` |
| PATCH | `/api/v1/admin/products/{id}` | `v1.admin.products.update` | `…@update` | 200 `{data: Product}` |
| DELETE | `/api/v1/admin/products/{id}` | `v1.admin.products.destroy` | `…@destroy` | 204 |
| POST | `/api/v1/admin/products/{id}/image` | `v1.admin.products.image.store` | `…@storeImage` | 200 `{data: Product}` |
| DELETE | `/api/v1/admin/products/{id}/image` | `v1.admin.products.image.destroy` | `…@destroyImage` | 200 `{data: Product}` |

Admin responses include `cost_cents`.

**Index query params:** `per_page` (1–100, default 25) · `cursor` · `search` (`max:100`, contains on `name` or `sku`) · `category_id` (integer) · `is_available` (`boolean`). Includes products in inactive categories; excludes soft-deleted ones. Ordered by `sort_order`, then `name`, then `id`.

**Body fields (store / update)**
| Name | Type | Store | Update | Validation rules |
|---|---|---|---|---|
| `category_id` | integer | required | sometimes | `integer`, exists as a **non-deleted** category (it may be inactive) |
| `name` | string | required | sometimes | `string`, `max:120` |
| `sku` | string\|null | optional | sometimes | `nullable`, `string`, `max:50`, `alpha_dash`, unique (case-insensitive) among non-deleted products, ignoring itself on update |
| `description` | string\|null | optional | sometimes | `nullable`, `string`, `max:500` |
| `price_cents` | integer | required | sometimes | `integer`, `min:0`, `max:100000000` (₱1,000,000) |
| `cost_cents` | integer | optional (default 0) | sometimes | `integer`, `min:0`, `max:100000000` |
| `is_vatable` | boolean | optional (default `true`) | sometimes | `boolean` |
| `is_available` | boolean | optional (default `true`) | sometimes | `boolean` |
| `track_stock` | boolean | optional (default `false`) | sometimes | `boolean` |
| `sort_order` | integer | optional (default 0) | sometimes | `integer`, `min:0`, `max:65535` |

Money fields must be **JSON integers**. `"50.00"`, `50.5` or `"5000"` return `422` (`integer` rule, strictly checked). The app converts ₱ input to centavos before sending.

**Delete:** a soft delete with no conflict rule; order lines (later phases) keep their own snapshot of the product.
**Image upload / delete:** same rules as categories.
**Audit:** a price change is recorded as `product.updated` with `changes: { "price_cents": { "from": 5000, "to": 5500 } }`, and likewise for every changed field.

**Errors (all admin product endpoints):** `401` · `403` · `404` · `422`

### Dev seed data (local only, added to DevSeeder)
Categories: **Breakfast** (sort 10), **Meals** (20), **Drinks** (30). Products, all with no image:
- **Breakfast:** Egg with Rice ₱50.00, Hot Dog ₱80.00
- **Meals:** Fried Chicken ₱100.00
- **Drinks:** Iced Tea ₱35.00 and Bottled Water ₱20.00, both with `track_stock: true`

SKUs are `BRK-001`… style, and costs are about 45% of price.

---

## Feature: Staff & Customers (Phase 1b)
Status: **APPROVED** (2026-09-24) · **Revision 2: APPROVED** (2026-09-24) (customer contact search applies only to phone-like terms)

Two parts:
1. **Staff management:** managers and owners create and edit staff accounts, reset passwords, set PINs (used by the Phase 2 quick-switch), and deactivate or delete staff. Permission: `user.manage`.
2. **Customers:** an optional customer record for a sale. Any cashier can look up, add and edit customers at the counter (permission `sale.create`); only managers and owners can delete them (new permission `customer.manage`). Customers are **global** (not branch-scoped), per PROJECT_MEMORY §5.2.

### New permission
`customer.manage` ("Delete customer records"), granted to **Owner** and **Manager**. Permission slugs are now **14**. The Phase 0 roles table gains it for those two roles: Owner = all 14; Manager = all except `branch.all`.

### Staff rules (enforced server-side on every staff endpoint)
- **Branch:** staff are always created in, and listed from, the **caller's branch**. `branch_id` is never accepted as input.
- **Role hierarchy ("you can't grant what you don't have"):** a caller may create, edit, reset, deactivate or delete a user **only if that user's role's permissions are a subset of the caller's own permissions**, and may **assign** a role only under the same condition. With the seeded roles:
  - an Owner can manage everyone
  - a Manager can manage Managers and Cashiers, **never an Owner**, and cannot assign the Owner role
  - Acting on a user you can't manage → `403`. Assigning a role you can't assign → `422` on `role_id`: `You cannot assign this role.`
- **Self-protection** (prevents lock-out), each a `409`:
  - changing your own role → `You cannot change your own role.`
  - deactivating yourself → `You cannot deactivate your own account.`
  - deleting yourself → `You cannot delete your own account.`
- **Sessions:** deactivating, deleting, or resetting a user's password **revokes all of that user's tokens** at once. The one exception: when you reset your **own** password, your current token is kept. A role change needs no revocation, because permissions are read live on every request.
- **Email** is stored **lowercased and trimmed**, and is unique among non-deleted users (case-insensitive).
- **Password policy** (create and reset): `required`, `string`, min **10** characters, at least one uppercase, one lowercase and one number (Laravel `Password::min(10)->mixedCase()->numbers()`), max 255. There is no confirmation field: the app offers a show/hide toggle instead.
- **PIN** (optional, write-only): exactly **4–6 digits**, as a **string** (so leading zeros survive). It must not be all one digit (`1111`) or a straight sequence (`1234`, `4321`, `123456`). It is stored hashed (`pin_hash`) and never returned. Responses only show `has_pin`. Send `pin: null` to remove the PIN.
- **Audit:** `user.created`, `user.updated` (changed fields as `{from, to}`, but **never** password or PIN values), `user.deleted`, `user.password_reset`, `user.pin_set`, `user.pin_removed`.

### Shared object: `StaffUser`
Used by every staff endpoint, including the existing list. It extends the Phase 0 list item with two fields.
```json
{
  "id": 3,
  "name": "Carla Cashier",
  "email": "cashier@pos.test",
  "is_active": true,
  "has_pin": false,
  "can_manage": true,
  "last_login_at": "2026-09-24T02:54:59Z",
  "role": { "id": 3, "slug": "cashier", "name": "Cashier" },
  "created_at": "2026-09-24T01:55:04Z",
  "updated_at": "2026-09-24T01:55:27Z"
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id`, `name`, `email`, `is_active`, `last_login_at`, `role`, `created_at`, `updated_at` | as in Phase 0 | as in Phase 0 | |
| `has_pin` | boolean | no | **New.** Whether a PIN is set |
| `can_manage` | boolean | no | **New.** Whether the **caller** may edit, reset, deactivate or delete this user under the hierarchy rule. It is `true` for the caller's own record, though self-protection still applies. It's a UI hint: the server enforces. |

### GET /api/v1/admin/users (extended)
Same route, controller, permission, pagination, ordering and scope as Phase 0. Items are now `StaffUser`. **New optional query params:** `role_id` (`integer`) and `is_active` (`boolean`, accepting `1`/`0`/`true`/`false`).

### Staff endpoints (permission `user.manage`)
| Method | URI | Route name | Controller | Success |
|---|---|---|---|---|
| POST | `/api/v1/admin/users` | `v1.admin.users.store` | `Api\V1\Admin\UserController@store` | 201 `{data: StaffUser}` |
| GET | `/api/v1/admin/users/{id}` | `v1.admin.users.show` | `…@show` | 200 `{data: StaffUser}` |
| PATCH | `/api/v1/admin/users/{id}` | `v1.admin.users.update` | `…@update` | 200 `{data: StaffUser}` |
| DELETE | `/api/v1/admin/users/{id}` | `v1.admin.users.destroy` | `…@destroy` | 204 (soft delete) |
| POST | `/api/v1/admin/users/{id}/password` | `v1.admin.users.password` | `…@resetPassword` | 204 |
| PUT | `/api/v1/admin/users/{id}/pin` | `v1.admin.users.pin` | `…@setPin` | 200 `{data: StaffUser}` |
| GET | `/api/v1/admin/roles` | `v1.admin.roles.index` | `Api\V1\Admin\RoleController@index` | 200, paginated |

A user in **another branch** is treated as not found (`404`).

**POST /admin/users: body**
| Name | Type | Required | Validation rules |
|---|---|---|---|
| `name` | string | yes | `string`, `max:100` |
| `email` | string | yes | `email`, `max:255`, unique among non-deleted users (case-insensitive) |
| `password` | string | yes | password policy above |
| `role_id` | integer | yes | `integer`, exists, assignable by the caller (else `You cannot assign this role.`) |
| `is_active` | boolean | no (default `true`) | `boolean` |
| `pin` | string\|null | no | PIN rules above |

**PATCH /admin/users/{id}: body** (partial). Allowed fields: `name`, `email`, `role_id`, `is_active`, with the same rules as create. A password is **not** accepted here (use `/password`), and neither is a PIN (use `/pin`); such fields are ignored.

**POST /admin/users/{id}/password: body:** `password` (password policy). `204`. Revokes the target's tokens, as described in the rules above.

**PUT /admin/users/{id}/pin: body:** `pin` (string, PIN rules, or `null` to remove). `200` with `StaffUser` (`has_pin` updated).

**GET /admin/roles:** cursor envelope (`per_page` default 100, max 100), ordered by `id`. Item:
```json
{ "id": 2, "slug": "manager", "name": "Manager", "is_admin": true, "max_discount_percent": 100,
  "permissions": ["customer.manage", "discount.apply", "..."], "assignable": true }
```
`assignable` = whether the **caller** may assign this role. `permissions` are sorted A→Z.

**Errors (staff endpoints):** `401` · `403` (missing `user.manage`, or the target is above your role) · `404` · `409` (self-protection messages) · `422`

### Shared object: `Customer`
```json
{
  "id": 12,
  "first_name": "Maria",
  "last_name": "Santos",
  "full_name": "Maria Santos",
  "contact": "0917 123 4567",
  "email": "maria@example.com",
  "notes": "Prefers less rice",
  "created_at": "2026-09-24T03:00:00Z",
  "updated_at": "2026-09-24T03:00:00Z"
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `first_name` | string | no | |
| `last_name` | string | yes | |
| `full_name` | string | no | `first_name` + `" "` + `last_name`, trimmed |
| `contact` | string | yes | Phone number as typed |
| `email` | string | yes | Stored lowercased. **Not** unique (families share emails). |
| `notes` | string | yes | |
| `created_at`, `updated_at` | date-time | no | |

### Customer endpoints
| Method | URI | Route name | Controller | Permission | Success |
|---|---|---|---|---|---|
| GET | `/api/v1/customers` | `v1.customers.index` | `Api\V1\CustomerController@index` | any authenticated user | 200, paginated |
| POST | `/api/v1/customers` | `v1.customers.store` | `…@store` | `sale.create` | 201 `{data: Customer}` |
| GET | `/api/v1/customers/{id}` | `v1.customers.show` | `…@show` | any authenticated user | 200 `{data: Customer}` |
| PATCH | `/api/v1/customers/{id}` | `v1.customers.update` | `…@update` | `sale.create` | 200 `{data: Customer}` |
| DELETE | `/api/v1/customers/{id}` | `v1.customers.destroy` | `…@destroy` | `customer.manage` | 204 (soft delete) |

**Index query params:** `per_page` (1–100, default 25) · `cursor` · `search` (`max:100`; case-insensitive "contains" on first name, last name, the full name, email, **and** contact). For contact, both the search term and the stored value are compared as **digits only**, so `09171234567` finds `0917 123 4567`. **Revision 2:** the contact clause applies **only when the whole term looks like a phone number**, meaning it matches `^[0-9+()\-\s]+$` and contains at least 3 digits. So `juan88` searches names and email only, never phones. Ordered by `first_name`, then `last_name`, then `id`. Excludes soft-deleted customers.

**Body fields (store / update; update is partial)**
| Name | Type | Store | Validation rules |
|---|---|---|---|
| `first_name` | string | required | `string`, `max:60` (not nullable on update) |
| `last_name` | string\|null | optional | `nullable`, `string`, `max:60` |
| `contact` | string\|null | optional | `nullable`, `string`, `max:30`, `regex:/^[0-9+()\-\s]+$/` (digits, spaces, `+ ( ) -`) |
| `email` | string\|null | optional | `nullable`, `email`, `max:255` |
| `notes` | string\|null | optional | `nullable`, `string`, `max:500` |

**Errors (customer endpoints):** `401` · `403` · `404` · `422`

### Dev seed data (local only, added to DevSeeder)
- **Staff:** `manager2@pos.test` (Manager, with a PIN `2580`), and existing users gain PINs: cashier `1357`, manager `2468`. The password is still `password` for seeded accounts (the policy applies to new passwords only).
- **Customers:** Maria Santos (0917 123 4567), Juan Dela Cruz (0918 765 4321, `juan@example.com`), Ana Reyes (no contact).

---

## Feature: Dashboard (Phase 1c)
Status: **APPROVED** (2026-09-24)

One endpoint feeds the app's dashboard. It returns **only real data that exists today**: catalogue health and margins, staff readiness, customers, and activity from the audit log. **Sales KPIs do not exist until orders do** (Phase 3). The `sales` key is reserved and is **always `null`** in this phase, and the app shows an honest "no sales yet" state. **No figure is ever estimated or invented.**

### GET /api/v1/dashboard
| | |
|---|---|
| Route name | `v1.dashboard` |
| Controller | `Api\V1\DashboardController@show` |
| Auth | yes (any authenticated user). **Each section is gated by permission.** A section the caller may not see is `null` (the key is always present). |
| Idempotent | n/a |

**Query params:** none. Everything is scoped to the **caller's branch** (staff, activity) or is global (catalogue, customers), as each section notes.

**Time:** "day" means the branch's **business day**: the branch `timezone`, with the day starting at `day_start_time` (PROJECT_MEMORY §4.4). Day buckets are `YYYY-MM-DD` labels of business days, oldest first.

**Percentages** are integers in **basis points** (`5500` = 55.00%), never floats.

**Margin** of a product = `(price_cents − cost_cents) / price_cents`, in basis points. Products with `price_cents = 0` or `cost_cents = 0` are **excluded** from margin figures (the margin is unknown or meaningless) and counted separately.

**200 response**
```json
{
  "data": {
    "generated_at": "2026-09-24T07:00:00Z",
    "business_date": "2026-09-24",
    "catalog": {
      "products_total": 5,
      "products_available": 5,
      "products_unavailable": 0,
      "products_without_image": 5,
      "products_tracking_stock": 2,
      "products_without_cost": 0,
      "categories_total": 3,
      "categories_active": 3,
      "categories_empty": 0,
      "average_margin_bps": 5500,
      "low_margin_threshold_bps": 3000,
      "low_margin_products": [
        { "id": 9, "name": "Iced Tea", "category_name": "Drinks", "price_cents": 3500, "cost_cents": 2800, "margin_bps": 2000 }
      ],
      "by_category": [
        { "category_id": 1, "name": "Breakfast", "is_active": true, "products_total": 2, "products_available": 2, "average_margin_bps": 5500 }
      ]
    },
    "staff": {
      "total": 5,
      "active": 4,
      "inactive": 1,
      "without_pin": 1,
      "never_logged_in": 2,
      "by_role": [ { "role_id": 1, "slug": "owner", "name": "Owner", "count": 1 } ],
      "recent_logins": [ { "user_id": 3, "name": "Carla Cashier", "role_name": "Cashier", "last_login_at": "2026-09-24T06:46:05Z" } ]
    },
    "customers": {
      "total": 3,
      "new_last_7_days": 3,
      "new_last_30_days": 3
    },
    "activity": {
      "logins_by_day": [ { "date": "2026-09-18", "count": 0 }, { "date": "2026-09-24", "count": 6 } ],
      "changes_by_day": [ { "date": "2026-09-18", "count": 0 }, { "date": "2026-09-24", "count": 14 } ],
      "recent_changes": [
        { "id": 88, "action": "product.updated", "summary": "Updated product \"Egg with Rice\"", "actor_name": "Marco Manager", "created_at": "2026-09-24T06:40:00Z" }
      ]
    },
    "sales": null,
    "insights": [
      { "key": "products_without_image", "severity": "info", "title": "5 products have no photo", "message": "Photos make the menu faster to scan at the counter.", "count": 5, "action": "menu.products" }
    ]
  }
}
```

**Sections and gating**
| Section | Visible with | Scope | Notes |
|---|---|---|---|
| `catalog` | `report.view` | global | All counts exclude soft-deleted rows. `low_margin_products`: margin below `low_margin_threshold_bps` (fixed **3000** = 30% for now), lowest first, **max 5**. `by_category`: every non-deleted category, ordered like the menu (`sort_order`, `name`, `id`); its `average_margin_bps` is `null` when no product qualifies. `average_margin_bps` (overall) is `null` when no product qualifies. |
| `staff` | `user.manage` | caller's branch | Non-deleted users. `by_role`: every role, including those with count 0, ordered by role `id`. `recent_logins`: the 5 latest non-null `last_login_at`, newest first. |
| `customers` | any authenticated user | global | Non-deleted customers. The windows count from `created_at` against now. |
| `activity` | `report.view` | caller's branch (audit entries whose actor belongs to it) | `logins_by_day` counts `auth.login` entries; `changes_by_day` counts every other entry except `auth.*`. Each has **exactly 7 entries**: the last 7 business days including today, oldest first, with 0-filled gaps. `recent_changes`: the 8 latest non-`auth.*` entries, newest first. `summary` is a short human sentence built server-side. It **never** includes passwords, PINs or hashes. |
| `sales` | n/a | n/a | **Always `null` in Phase 1c.** Reserved; its shape is defined in the phase that introduces orders. |
| `insights` | derived | n/a | Built **only** from sections the caller can see. Always an array (may be empty). Ordered `critical` → `warning` → `info`, then by `key`. |

**Insight object**
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `key` | string | no | Stable id (see the table below) |
| `severity` | `"critical" \| "warning" \| "info"` | no | |
| `title` | string | no | Short, with the count, e.g. `"2 products are unavailable"` |
| `message` | string | no | One sentence of advice |
| `count` | integer | no | |
| `action` | string | yes | App destination key: `menu.products`, `menu.categories`, `staff`, `customers`, or `null` |

**Insight rules** (each is emitted only when `count > 0`)
| `key` | Severity | Count | Needs section | Action |
|---|---|---|---|---|
| `products_without_cost` | warning | products with `cost_cents = 0` | catalog | `menu.products` |
| `low_margin_products` | warning | products under the threshold (the full count, not capped at 5) | catalog | `menu.products` |
| `staff_without_pin` | warning | **active** users without a PIN (the PIN quick-switch arrives in Phase 3) | staff | `staff` |
| `products_unavailable` | info | unavailable products | catalog | `menu.products` |
| `products_without_image` | info | products with no image | catalog | `menu.products` |
| `categories_empty` | info | non-deleted categories with no non-deleted products | catalog | `menu.categories` |
| `staff_never_logged_in` | info | active users with `last_login_at = null` | staff | `staff` |

**Errors:** `401`

---

## Feature: Catalogue Sync (Phase 2)
Status: **APPROVED** (2026-09-24)

The tablet keeps its own copy of the menu (categories and products) in on-device SQLite, so staff can browse it with no internet. The app pulls the menu from the endpoint below: a **full baseline** the first time, then **deltas** (only what changed or was deleted since the last sync).

- Catalogue data is **reference data** and is **pull-only** (PROJECT_MEMORY.md §8.1). The device never edits it. Admin edits still go through the Phase 1a admin endpoints while online, and the app pulls again afterwards.
- The catalogue is **global**: categories and products have no `branch_id`, so every authenticated user gets the same rows.
- This endpoint covers the catalogue only. The general `GET /api/v1/sync/changes` (users, printers, settings) arrives with the offline phase (Phase 5).
- There is **no PIN** in Phase 2. The PIN quick-switch moved to Phase 3.

### GET /api/v1/sync/catalogue
| | |
|---|---|
| Route name | `v1.sync.catalogue` |
| Controller | `Api\V1\SyncController@catalogue` |
| Auth | yes (any user) |
| Idempotent | n/a (read-only) |

**Query params**
| Name | Type | Required | Rules | Notes |
|---|---|---|---|---|
| `cursor` | string | no | `string`, `max:1000` | Opaque. Leave it out for a **full baseline**. Otherwise pass back the `meta.next_cursor` from the previous response, unchanged. |
| `limit` | integer | no | `integer`, `min:1`, `max:500` | Default 500. The maximum rows **per entity** per page: up to `limit` categories (changed plus deleted) and up to `limit` products (changed plus deleted). |

**200 response**
```json
{
  "data": {
    "categories": [
      {
        "id": 2,
        "name": "Breakfast",
        "description": "Served until 11 AM",
        "sort_order": 10,
        "is_active": true,
        "image_url": "http://192.168.1.7:8000/storage/categories/2/9f1c2a.webp",
        "image_path": "categories/2/9f1c2a.webp",
        "updated_at": "2026-09-24T01:00:00Z"
      }
    ],
    "products": [
      {
        "id": 7,
        "category_id": 2,
        "sku": "BRK-001",
        "name": "Egg with Rice",
        "description": "Two fried eggs, garlic rice",
        "price_cents": 5000,
        "is_vatable": true,
        "is_available": true,
        "track_stock": false,
        "sort_order": 0,
        "image_url": null,
        "image_path": null,
        "updated_at": "2026-09-24T01:00:00Z"
      }
    ],
    "deleted": {
      "categories": [5],
      "products": [12, 13]
    }
  },
  "meta": {
    "full": false,
    "has_more": false,
    "next_cursor": "eyJ2IjoxLCJjIjpbIjIwMjYtMDktMjRUMDE6MDA6MDBaIiwwXSwicCI6WyIyMDI2LTA5LTI0VDAxOjAwOjAwWiIsMF19",
    "server_time": "2026-09-24T01:05:12Z"
  }
}
```

**`SyncCategory`** (in `data.categories`)
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `name` | string | no | |
| `description` | string | yes | |
| `sort_order` | integer | no | |
| `is_active` | boolean | no | **Inactive categories are included**, and the device hides them itself (see *Device visibility rules*) |
| `image_url` | string (absolute URL) | yes | |
| `image_path` | string | yes | Changes whenever the image changes. Use it as the image cache key. |
| `updated_at` | date-time | no | |

There is no `products_count` (the device counts locally) and no `created_at`.

**`SyncProduct`** (in `data.products`)
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `category_id` | integer | no | Only the id. There's no embedded category, so renaming a category never makes product rows stale. |
| `sku` | string | yes | |
| `name` | string | no | |
| `description` | string | yes | |
| `price_cents` | integer | no | VAT-inclusive selling price in centavos |
| `is_vatable` | boolean | no | |
| `is_available` | boolean | no | **Unavailable products are included** (the POS greys them out) |
| `track_stock` | boolean | no | |
| `sort_order` | integer | no | |
| `image_url` | string (absolute URL) | yes | |
| `image_path` | string | yes | |
| `updated_at` | date-time | no | |

**`cost_cents` is never sent** by this endpoint, not even to admins. The key is absent, as on `GET /products`.

**`data.deleted`**: `categories` and `products` are arrays of integer ids, each sorted ascending. Both keys are always present and may be empty arrays.

**`meta`**
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `full` | boolean | no | `true` when this run started without a cursor (a baseline). It is the same on every page of that run. |
| `has_more` | boolean | no | `true`: call again at once with `next_cursor`, because the run isn't finished. `false`: the device is up to date as of this response. |
| `next_cursor` | string | no | Always present, including on the last page. Store it and send it on the next sync. |
| `server_time` | date-time | no | The server clock at the time of the response. The app shows it as "Synced at …". |

**Server rules**
1. **Baseline** (no `cursor`): returns every **non-deleted** category and product, including inactive and unavailable ones. `deleted` is always empty in a baseline.
2. **Delta** (with `cursor`): returns every category and product whose `updated_at` falls in the cursor's window. Rows that are soft-deleted go into `deleted` (their ids only) and the rest go into `categories`/`products`. The same id never appears in both lists of one entity on the same page.
3. **Paging:** each entity uses keyset paging on `(updated_at, id)`, ascending. `has_more` is `true` when either entity has rows left, and each entity's page is paged independently within the run.
4. **Nothing is missed.** On the **last page of a run**, `next_cursor` restarts the next delta at `updated_at >= min(newest updated_at seen in this run, the run's start) − 5 seconds`, where the run's start is the `server_time` of the run's **first** page (see Q-001). The restart point is never earlier than the run's own restart point. If the run saw no rows, the previous restart point is kept unchanged, so it never drifts backwards. The next delta re-sends a few recent rows on purpose. This covers the second-precision timestamps and writes that commit while a sync is running. The device upserts, so the repeats are harmless.
5. **Writes and `updated_at`:** every change that affects a synced field updates `updated_at`. This includes create, update, soft delete, image upload and image removal (all of these go through Eloquent in Phase 1a). Any future bulk update must set `updated_at` too.
6. A cursor that can't be decoded, has an unknown version, or points into the future returns **`422`** on `cursor`, with the message `The sync cursor is invalid. Start a full sync.`

**Errors**
| Status | When | Body |
|---|---|---|
| `401` | Missing, invalid, or expired token | Global |
| `422` | Invalid `limit`, or an invalid `cursor` | Global 422 shape. For the cursor: `{"message": "The sync cursor is invalid. Start a full sync.", "errors": {"cursor": ["The sync cursor is invalid. Start a full sync."]}}` |

### Device rules (frontend)
**Applying pages**
- **Delta pages** are applied **one page per SQLite transaction**: upsert the rows by `id`, then delete the ids in `deleted` (deleting an id the device doesn't have does nothing). Save `next_cursor` **in the same transaction**, then continue while `has_more`.
- **A baseline run** (`full: true`) collects all its pages in memory (the catalogue is small), then **replaces** both local tables and saves the cursor in **one** transaction after the last page. A baseline that fails partway leaves the old local menu in place.
- A `422` on the cursor starts a new baseline straight away (once per run, so it can't loop).
- A `401` follows the Global Conventions (sign out), but the local catalogue is **kept**.
- **Only one sync runs at a time.** A trigger during a run is merged into it, not queued.

**When to start a baseline instead of a delta**
- no stored cursor (first launch, or after a reinstall)
- the API origin (`EXPO_PUBLIC_API_URL`) differs from the one saved with the cursor, so data from two servers never mixes
- a local schema migration asks for one
- a `422` on the cursor

**When to sync:** after a successful login and after a session restore; when the app returns to the foreground; every 5 minutes while in the foreground and online; on "Sync now"; and after any successful admin category or product create, update, delete, or image change in the app.

**Offline:** when the network is unavailable (`expo-network`), skip the request and set the status to `offline`. Never clear the local menu because of a network error.

**Images:** after each successful run, prefetch the `image_url` of every **visible** row into the `expo-image` **disk** cache (`cachePolicy: "disk"`/`"memory-disk"`), keyed by the URL (expo-image keys the prefetch by URL, and `image_path`, and therefore `image_url`, changes whenever the image changes; see Q-002), so tiles show images offline. A failed prefetch is ignored.

**Logout keeps the catalogue.** It contains no cost and isn't specific to a user.

**Device visibility rules** (the Sell screen must match `GET /categories` and `GET /products`)
- **Categories:** `is_active = 1`. Order by `sort_order`, then `name` (case-insensitive, `COLLATE NOCASE`), then `id`.
- **Products:** their category exists locally **and** `is_active = 1`. Unavailable products **are shown**, greyed out and not tappable. Same ordering as categories.
- **Category product count:** available products in that category, as on `GET /categories`.
- **Search:** case-insensitive "contains" on `name` or `sku` (`LIKE` with escaped `%` and `_`).

**Sync status** (shown in the Sell header): `syncing` · `synced` (with "Synced N min ago" from `server_time`) · `offline` · `error` (with a message, a "Sync now" retry, and the last good menu still shown). The Phase 5 sync queue UX builds on this.

### Sell screen (read-only in Phase 2)
The sidebar module `sell` becomes `ready` for every signed-in user, with the route `/(app)/(pos)/sell`. The screen reads **only** from SQLite: a category rail plus a product tile grid (name, price, image, and an "Unavailable" state), with search. There is no cart and nothing happens on tap: the cart and checkout arrive in Phase 3 on this same screen. Empty state before the first sync: "Menu not synced yet" with a "Sync now" button. The layout comes from `useResponsive` (tablet first, phone and both orientations).

---

## Feature: Core Sale (Phase 3)
Status: **APPROVED** (2026-09-25)

Cashiers ring up sales on the Sell screen and complete them **online**. The server prices every sale itself, allocates the invoice and queue numbers, records the payments, and depletes stock, all in **one transaction**. The same feature adds the PIN quick-switch, manager approval of discounts, a minimal stock adjustment, order history, and real sales figures on the dashboard.

**Scope decisions (user, 2026-09-25)**
- **Online only.** The app needs a connection to complete a sale. Offline sales, the outbox and the device `order_no` arrive in Phase 5.
- **No shifts yet.** Orders have no `shift_id` in this phase. Phase 6 adds opening and closing shifts, and from then on a sale requires an open shift.
- **Senior Citizen / PWD discounts are deferred** until the accountant confirms the rules. Discount types in this phase: `promo`, `employee`, `manual`.
- **Stock:** a minimal adjustment endpoint (`inventory.adjust`) plus `stock_qty` on the admin `Product`. An online sale is **blocked** when a `track_stock` product runs short (PROJECT_MEMORY §4.5).
- **Extras:** order history (`GET /orders`, `GET /orders/{ulid}`), today's sales on the dashboard, and per-line discounts alongside the order discount.

**Not in this phase:** voids and refunds (Phase 7), printing (Phase 4), shifts and X/Z-reads (Phase 6), offline sales (Phase 5), a stock movement history screen, and stock figures in the catalogue sync.

### Sale pricing (the server is authoritative; the app runs the same algorithm for display and for the checksum)

All values are integer centavos. `rhu(n, d)` means **round half up** for `n ≥ 0`, `d > 0`: `floor((n + floor(d / 2)) / d)`. Intermediate products can exceed 2^53, so the app must compute them with `BigInt`. PHP's 64-bit integers are enough, given the size limit below.

1. **Line gross:** `gross_cents = unit_price_cents × qty`. `unit_price_cents` is the product's current `price_cents` on the server (VAT-inclusive).
2. **Line discount** (optional): with `kind: "percent"`, `line_discount_cents = rhu(gross_cents × value, 10000)`, where `value` is in basis points. With `kind: "amount"`, `line_discount_cents = value`. The result must be `≤ gross_cents`.
3. **Line net:** `net_cents = gross_cents − line_discount_cents`. **Discount base:** `B = Σ net_cents`.
4. **Order discount** (optional), applied to `B`: `percent` gives `D = rhu(B × value, 10000)`, and `amount` gives `D = value`. `D` must be `≤ B`. With no order discount, `D = 0`.
5. **Allocating `D` to the lines**, pro rata to `net_cents`, by the largest remainder: `floor_i = floor(D × net_i / B)` and `rem_i = (D × net_i) mod B`. The `D − Σ floor_i` leftover centavos go one each to the lines with the **largest** `rem_i`, with ties going to the **lower line index**. This gives `order_discount_share_cents`. (When `B = 0`, every share is 0.)
6. **Line total:** `line_total_cents = net_cents − order_discount_share_cents`.
7. **Order totals:** `subtotal_cents = Σ gross_cents`, `line_discounts_cents = Σ line_discount_cents`, `discount_cents = line_discounts_cents + D`, and `total_cents = subtotal_cents − discount_cents` (which always equals `Σ line_total_cents`).
8. **VAT** (Philippine VAT is included in the price; rate from `config('pos.vat_rate_bps')`, which is `1200`): `V = Σ line_total_cents` of **vatable** lines; `vatable_sales_cents = rhu(V × 10000, 10000 + 1200)`; `vat_amount_cents = V − vatable_sales_cents`; `vat_exempt_sales_cents = Σ line_total_cents` of **non-vatable** lines. VAT is rounded **once per order**, never per line.
9. **Size limit:** `subtotal_cents ≤ 1000000000` (₱10,000,000). Anything larger returns `422` on `items`: `This sale is too large.`

**Worked example B** (used in the request and response examples below; both sides must test against it). Line 1: ₱80.00 × 1, vatable, 10% line discount. Line 2: ₱45.00 × 2, not vatable. Line 3: ₱35.00 × 3, vatable. Order discount: ₱10.00.
| Line | gross | line discount | net | share of D=1000 | line total |
|---|---|---|---|---|---|
| 1 | 8000 | 800 | 7200 | 269 + 1 = **270** (largest remainder) | 6930 |
| 2 | 9000 | 0 | 9000 | 337 | 8663 |
| 3 | 10500 | 0 | 10500 | 393 | 10107 |

`subtotal 27500 · line_discounts 800 · discount 1800 · total 25700 · V = 17037 → vatable_sales 15212 · vat 1825 · vat_exempt 8663`.

**Worked example A** (no discount): ₱50.00 × 2 and ₱35.00 × 1, both vatable → `subtotal 13500 · discount 0 · total 13500 · vatable_sales 12054 · vat 1446 · vat_exempt 0`.

### Discount rules
- Each discount (line or order) is `{ "type": "promo" | "employee" | "manual", "kind": "percent" | "amount", "value": <int> }`. `percent`: `value` in basis points, `1–10000`. `amount`: `value` in centavos, `1–1000000000`. `senior_citizen` and `pwd` return `422` (`The selected type is invalid.`) until they're approved.
- **Approval needed** when `discount_cents > 0` **and** either the cashier lacks `discount.apply`, or `discount_cents × 100 > subtotal_cents × role.max_discount_percent` (exact integer comparison, over **all** discounts on the order).
- Approval is given in the same request as `discount_authorization: { "user_id": <int>, "pin": "<4–6 digits>" }`. The approver must be **active**, in the **caller's branch**, have a PIN, have `discount.override`, **and** have a role limit that covers the discount (`discount_cents × 100 ≤ subtotal_cents × approver.max_discount_percent`). The approver is recorded as `authorized_by`.
- When no approval is needed, `discount_authorization` is ignored and `authorized_by` stays `null`.

### PIN attempts (shared by the PIN switch and discount approval)
5 incorrect PINs for the same PIN owner within 15 minutes lock that owner's PIN until the window ends. While it is locked, both endpoints return `429 { "message": "Too many incorrect PIN attempts. Try again in N minutes." }`, where `N` is the whole number of minutes remaining, rounded up. A correct PIN resets the counter. PINs are never logged, stored or echoed.

### GET /api/v1/auth/pin-users
| | |
|---|---|
| Route name | `v1.auth.pin-users` |
| Controller | `Api\V1\AuthController@pinUsers` |
| Auth | yes (any user) |
| Idempotent | n/a |

Lists the people who can PIN-switch on this device: **active**, non-deleted users in the **caller's branch** who **have a PIN**, including the caller. Ordered by `name`, then `id`. Uses the cursor envelope (`per_page` 1–100, default 100).
```json
{ "id": 2, "name": "Marco Manager", "role": { "slug": "manager", "name": "Manager" }, "can_approve_discounts": true, "max_discount_percent": 100 }
```
`can_approve_discounts` = the user has `discount.override`. `max_discount_percent` = the user's role limit. Both are UI hints: the app uses them to list only approvers who can cover the discount.
**Errors:** `401` · `422` (invalid `per_page` or `cursor`)

### POST /api/v1/auth/pin
| | |
|---|---|
| Route name | `v1.auth.pin` |
| Controller | `Api\V1\AuthController@pin` |
| Auth | yes (the device's current session) |
| Idempotent | no |

**Body:** `user_id` (`required`, `integer`) · `pin` (`required`, `string`, `regex:/^\d{4,6}$/`; the PIN strength rules apply only when a PIN is **set**).

Checks run in this order, and the first failure wins:
| Check | Status | Body |
|---|---|---|
| Field validation | `422` | Global shape |
| Target is unknown, deleted, inactive, in another branch, or has no PIN | `422` | on `user_id`: `This person can't sign in with a PIN.` |
| Target's PIN is locked | `429` | see *PIN attempts* |
| Wrong PIN (counts as an attempt) | `422` | on `pin`: `Incorrect PIN.` |

**On success**, the server issues a new `mobile-app` token for the **target** (same TTL as login) and **revokes the token that made this request** (the previous user's session on this device ends). It also sets the target's `last_login_at` and writes `auth.pin_switch` (actor = the target, `changes: { "from_user_id": <int> }`). Switching to yourself is allowed; it simply renews the token.
**200 response:** exactly the `POST /auth/login` response shape (`token`, `token_type`, `expires_at`, `user: AuthUser`).
**Errors:** `401` · `422` · `429`

### POST /api/v1/orders
| | |
|---|---|
| Route name | `v1.orders.store` |
| Controller | `Api\V1\OrderController@store` |
| Auth | yes (permission `sale.create`) |
| Idempotent | **yes**: `Idempotency-Key` = the body's `ulid` |

**Body** (worked example B; ids are illustrative)
```json
{
  "ulid": "01K62Z3K5Q9V7X2M4N6P8R0T1W",
  "customer_id": 12,
  "notes": null,
  "items": [
    { "product_id": 4, "qty": 1, "discount": { "type": "promo", "kind": "percent", "value": 1000 }, "notes": "No ketchup" },
    { "product_id": 11, "qty": 2, "discount": null, "notes": null },
    { "product_id": 9, "qty": 3, "discount": null, "notes": null }
  ],
  "discount": { "type": "promo", "kind": "amount", "value": 1000 },
  "payments": [
    { "method": "gcash", "amount_cents": 10000, "reference_no": "1012345678901" },
    { "method": "cash", "amount_cents": 20000, "reference_no": null }
  ],
  "client_total_cents": 25700,
  "discount_authorization": null
}
```
| Name | Type | Required | Validation rules | Notes |
|---|---|---|---|---|
| `ulid` | string | yes | `regex:/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/` | Client-generated ULID (uppercase Crockford base32). Must equal `Idempotency-Key`. |
| `customer_id` | integer\|null | no | `nullable`, `integer`, an existing non-deleted customer | |
| `notes` | string\|null | no | `nullable`, `string`, `max:255` | |
| `items` | array | yes | `array`, `min:1`, `max:100` | The same product may appear on several lines (for example, with different notes) |
| `items.*.product_id` | integer | yes | `integer` | See the menu checks below |
| `items.*.qty` | integer | yes | `integer`, `min:1`, `max:999` | Whole units only in this phase |
| `items.*.discount` | object\|null | no | a discount object (see *Discount rules*) | Line discount |
| `items.*.notes` | string\|null | no | `nullable`, `string`, `max:120` | For the kitchen (printed in Phase 4) |
| `discount` | object\|null | no | a discount object | Order discount |
| `payments` | array | yes | `array`, `max:5`; **empty only when `total_cents = 0`**, otherwise `min:1` | |
| `payments.*.method` | string | yes | `in:cash,gcash`; **at most one** `cash` | |
| `payments.*.amount_cents` | integer | yes | `integer`, `min:1`, `max:1000000000` | For **cash**: the amount **handed over** (tendered). For **GCash**: the amount paid. |
| `payments.*.reference_no` | string\|null | GCash: yes | GCash: `required`, `string`, `max:64`, `regex:/^[A-Za-z0-9-]+$/`. Cash: must be `null` or omitted. | |
| `client_total_cents` | integer | yes | `integer`, `min:0` | The app's computed `total_cents` (the checksum) |
| `discount_authorization` | object\|null | no | `user_id` (`integer`), `pin` (`string`, `regex:/^\d{4,6}$/`) | See *Discount rules* |

**Checks, in order** (after the idempotency replay check; the first failure wins):
1. **`403`** without `sale.create`. **`422`** for field validation.
2. **Menu:** every product must exist, not be deleted, be in an active, non-deleted category, and be `is_available`. Otherwise `422` on `items.{i}.product_id`: `This product is no longer on the menu.` or `"<name>" is unavailable.`
3. **Pricing:** a discount above its base returns `422` on `items.{i}.discount.value` or `discount.value`: `The discount can't be more than ₱<base>.` The size limit returns `422` on `items`.
4. **Checksum:** `|client_total_cents − total_cents| > 1` returns `422` on `client_total_cents`: `The menu has changed since your last sync. Review the new total.` A difference of exactly 1 is accepted, and `has_total_mismatch` is set to `true`.
5. **Payments**, in order: the GCash sum must not exceed `total_cents` (`422` on `payments`: `GCash can't be more than the total.`); the full sum must be at least `total_cents` (`422` on `payments`: `The payment is short by ₱<x>.`). Change = sum − total, and it comes out of the cash payment.
6. **Discount approval** (only when needed): with no `discount_authorization`, `422` on `discount_authorization`: `A manager must approve this discount.` An approver who doesn't qualify gets `422` on `discount_authorization.user_id`: `This person can't approve this discount.` A locked PIN returns `429`. A wrong PIN returns `422` on `discount_authorization.pin`: `Incorrect PIN.`
7. **Stock** (inside the transaction, with `lockForUpdate` on the `stock_levels` rows): for each `track_stock` product, the demand is **summed over all its lines**. A product with no `stock_levels` row has `0`. When the demand is greater than the quantity on hand, the response is `422` with **one message per line of that product** on `items.{i}.qty`: `Only <n> "<name>" left in stock.` (`n` can be 0).

**On success (one DB transaction):** allocate `invoice_no` = `INV-{branch.code}-{8-digit sequence}` (per branch, never reset) and `queue_no` (per branch and **business day**, starting at 1), both from a row-locked `sequences` table (never `COUNT(*)`). Then insert the order, its lines (with **snapshots** of `product_name`, `category_name`, `sku`, `unit_price_cents`, `unit_cost_cents` and `is_vatable`) and its payments. Write **one `sale` stock movement per `track_stock` product** (`qty_delta = −demand`, with the unit cost snapshot, referencing the order), update `stock_levels`, and write the `order.completed` audit entry (`changes: { "invoice_no", "total_cents", "authorized_by" }`). `placed_at` is the server time, and `business_date` is computed with the branch's business day.

**Stored payments:** cash stores `tendered_cents` = the amount sent, `change_cents` = the change, and `amount_cents` = tendered − change. GCash stores `amount_cents` = the amount sent, `tendered_cents = null` and `change_cents = 0`. So `Σ payments.amount_cents = total_cents` always holds.

**201 response:** `{ "data": Order }`.

### Shared object: `Order`
```json
{
  "ulid": "01K62Z3K5Q9V7X2M4N6P8R0T1W",
  "invoice_no": "INV-MAIN-00000042",
  "queue_no": 17,
  "business_date": "2026-09-25",
  "status": "completed",
  "placed_at": "2026-09-25T04:12:09Z",
  "cashier": { "id": 3, "name": "Carla Cashier" },
  "authorized_by": null,
  "customer": { "id": 12, "full_name": "Maria Santos" },
  "notes": null,
  "subtotal_cents": 27500,
  "line_discounts_cents": 800,
  "order_discount": { "type": "promo", "kind": "amount", "value": 1000, "amount_cents": 1000 },
  "discount_cents": 1800,
  "total_cents": 25700,
  "vatable_sales_cents": 15212,
  "vat_amount_cents": 1825,
  "vat_exempt_sales_cents": 8663,
  "tendered_cents": 30000,
  "change_cents": 4300,
  "client_total_cents": 25700,
  "has_total_mismatch": false,
  "items": [
    { "id": 101, "product_id": 4, "product_name": "Hot Dog", "category_name": "Breakfast", "sku": "BRK-002", "qty": 1, "unit_price_cents": 8000, "gross_cents": 8000, "is_vatable": true, "discount": { "type": "promo", "kind": "percent", "value": 1000 }, "line_discount_cents": 800, "order_discount_share_cents": 270, "line_total_cents": 6930, "notes": "No ketchup" },
    { "id": 102, "product_id": 11, "product_name": "Rice Cake", "category_name": "Meals", "sku": null, "qty": 2, "unit_price_cents": 4500, "gross_cents": 9000, "is_vatable": false, "discount": null, "line_discount_cents": 0, "order_discount_share_cents": 337, "line_total_cents": 8663, "notes": null },
    { "id": 103, "product_id": 9, "product_name": "Iced Tea", "category_name": "Drinks", "sku": "DRK-001", "qty": 3, "unit_price_cents": 3500, "gross_cents": 10500, "is_vatable": true, "discount": null, "line_discount_cents": 0, "order_discount_share_cents": 393, "line_total_cents": 10107, "notes": null }
  ],
  "payments": [
    { "method": "gcash", "amount_cents": 10000, "tendered_cents": null, "change_cents": 0, "reference_no": "1012345678901" },
    { "method": "cash", "amount_cents": 15700, "tendered_cents": 20000, "change_cents": 4300, "reference_no": null }
  ]
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `ulid` | string | no | The order's public id (routes use it, not an integer id) |
| `invoice_no` | string | no | |
| `queue_no` | integer | no | |
| `business_date` | date | no | |
| `status` | `"completed"` | no | The only status in Phase 3. Voided and refunded states arrive in Phase 7. |
| `placed_at` | date-time | no | |
| `cashier` | `{id, name}` | no | The user who completed the sale |
| `authorized_by` | `{id, name}` | yes | The discount approver, when approval was needed |
| `customer` | `{id, full_name}` | yes | A snapshot of the name is **not** stored; it reads the current record, including soft-deleted customers |
| `order_discount` | object | yes | `{type, kind, value, amount_cents}`, where `amount_cents` = `D` |
| `tendered_cents` | integer | no | `Σ amount_cents` of GCash + `Σ tendered_cents` of cash |
| `change_cents` | integer | no | |
| `items[].product_id` | integer | no | The product row is kept even if it is later soft-deleted (`RESTRICT`) |
| `items[].discount` | object | yes | As sent: `{type, kind, value}` |
| `payments[]` | | | In the order sent |
| other money fields | integer | no | See *Sale pricing* |

`unit_cost_cents` is stored on each line but **never returned**.

**Errors:** `401` · `403` · `409` (idempotency) · `422` · `429`

### GET /api/v1/orders
| | |
|---|---|
| Route name | `v1.orders.index` |
| Controller | `Api\V1\OrderController@index` |
| Auth | yes (`sale.create` **or** `report.view`, else `403`) |

**Visibility** (the same rule applies to `show`): orders in the **caller's branch** only. With `report.view`, all of the branch's orders are visible. Without it, only orders the caller rang up (`cashier.id` = caller).

**Query params:** `per_page` (1–100, default 25) · `cursor` · `business_date` (`date_format:Y-m-d`) · `cashier_id` (`integer`; without `report.view`, any value other than the caller's own id returns `403`) · `search` (`string`, `max:30`, case-insensitive "contains" on `invoice_no`). Ordered by `placed_at` descending, then `id` descending.

**Item (`OrderSummary`)**
```json
{ "ulid": "01K62Z3K5Q9V7X2M4N6P8R0T1W", "invoice_no": "INV-MAIN-00000042", "queue_no": 17, "business_date": "2026-09-25", "status": "completed", "placed_at": "2026-09-25T04:12:09Z", "cashier": { "id": 3, "name": "Carla Cashier" }, "customer": { "id": 12, "full_name": "Maria Santos" }, "items_count": 6, "total_cents": 25700, "payment_methods": ["cash", "gcash"] }
```
`items_count` = `Σ qty`. `payment_methods` = the distinct methods used, sorted A→Z.
**Errors:** `401` · `403` · `422`

### GET /api/v1/orders/{ulid}
Route `v1.orders.show`, `Api\V1\OrderController@show`. It uses the same permission and visibility as the list. An order that isn't visible, or doesn't exist, returns `404`. **200:** `{ "data": Order }`. **Errors:** `401` · `403` · `404`

### POST /api/v1/admin/products/{id}/stock-adjustments
| | |
|---|---|
| Route name | `v1.admin.products.stock.store` |
| Controller | `Api\V1\Admin\ProductStockController@store` |
| Auth | yes (permission `inventory.adjust`) |
| Idempotent | **yes**: `Idempotency-Key` = the body's `ulid` |

**Body:** `ulid` (as for orders) · **exactly one** of `qty_delta` (`integer`, non-zero, `−100000` to `100000`) **or** `counted_qty` (`integer`, `0` to `100000`; the server works out the delta under the row lock) · `reason` (`required`, `string`, `max:255`).
**Rules:** the product must have `track_stock = true`, else `409 { "message": "This product doesn't track stock." }`. A result below zero returns `422` on `qty_delta`: `Stock can't go below zero (<n> on hand).` A count equal to the quantity on hand returns `422` on `counted_qty`: `Stock is already <n>.` The adjustment writes one `adjustment` movement for the **caller's branch**, updates `stock_levels`, and writes the `stock.adjusted` audit entry (`changes: { "qty": { "from", "to" }, "reason" }`).
**201 response**
```json
{ "data": { "ulid": "01K62ZA1B2C3D4E5F6G7H8J9K0", "product_id": 9, "type": "adjustment", "qty_delta": 24, "qty_before": 26, "qty_after": 50, "reason": "Delivery from supplier", "occurred_at": "2026-09-25T02:00:00Z", "created_by": { "id": 2, "name": "Marco Manager" } } }
```
**Errors:** `401` · `403` · `404` · `409` · `422`

**Admin `Product` gains `stock_qty`** (integer, **nullable**): the caller's branch quantity on hand when `track_stock` is `true` (`0` if the product was never stocked), otherwise `null`. It appears on every **admin** product endpoint only. The read endpoint and the catalogue sync are unchanged.

### Dashboard: `sales` section (replaces the reserved `null`)
Visible with **`report.view`**, otherwise `null`. It covers the **caller's branch**, **today's business day**, and `completed` orders.
```json
"sales": {
  "business_date": "2026-09-25",
  "orders_count": 12,
  "items_sold": 34,
  "gross_sales_cents": 412000,
  "discounts_cents": 9000,
  "net_sales_cents": 403000,
  "vat_amount_cents": 38250,
  "average_order_cents": 33583,
  "by_payment_method": [
    { "method": "cash", "orders_count": 9, "amount_cents": 300000 },
    { "method": "gcash", "orders_count": 4, "amount_cents": 103000 }
  ],
  "last_7_days": [ { "date": "2026-09-19", "orders_count": 0, "net_sales_cents": 0 } ],
  "top_products": [ { "product_id": 9, "name": "Iced Tea", "qty": 14, "net_sales_cents": 45000 } ]
}
```
- `gross_sales_cents` = `Σ subtotal_cents`; `discounts_cents` = `Σ discount_cents`; `net_sales_cents` = `Σ total_cents`; `items_sold` = `Σ qty`.
- `average_order_cents` = `rhu(net_sales_cents, orders_count)`, or `0` when there are no orders.
- `by_payment_method`: **always both** methods (`cash`, then `gcash`). `orders_count` counts orders with at least one payment of that method, and `amount_cents` = `Σ` of the stored `amount_cents`, which is net of change.
- `last_7_days`: **exactly 7** entries, the last 7 business days including today, oldest first, with 0-filled gaps.
- `top_products`: today, grouped by `product_id`, **max 5**, ordered by `qty` descending, then `net_sales_cents` descending, then `name`. `name` is the most recent line snapshot, and `net_sales_cents` = `Σ line_total_cents`.
- With no sales today, every figure is 0 and the lists keep their fixed shapes: `by_payment_method` still has both methods, `last_7_days` still has 7 entries, and `top_products` is empty.
- **Activity change:** `changes_by_day` and `recent_changes` now leave out `order.*` entries as well as `auth.*`, so sales don't flood the activity feed (they appear in `sales`). `stock.adjusted` **is** shown, with the summary `Adjusted stock of "<name>" (+24)`.

### Clarifications (v1.5.1, recorded from the implementation)
These don't change any shape the app reads.
- **Idempotency scope:** a stored key belongs to the **branch** that used it. The same key sent from another branch counts as "a different request" (`409`). Within a branch, anyone who sends the same key, endpoint and body gets the stored response (for example, the next cashier retrying after a PIN switch).
- **Stuck keys:** a key still in the `processing` state after **60 seconds** belongs to a request that died. The next request with that key takes it over instead of getting `409` forever. The unique `ulid` on orders and on stock movements still prevents a double write.
- **Missing or malformed `Idempotency-Key`:** there is nothing to replay, so the normal checks run: `403` first, then the `422` on `idempotency_key` together with any other field errors.
- **Payments:** a second cash payment returns `422` on `payments.{i}.method` with `Only one cash payment is allowed.` An empty `payments` list on a sale above ₱0 is reported by the payment check (`The payment is short by ₱<x>.`). A cash payment that is returned entirely as change is stored with `amount_cents = 0`.
- **Error grouping:** the menu check reports **every** failing line at once. The pricing check reports every discount above its base, plus the size limit, together.
- **Messages:** peso amounts are formatted as `₱1,250.50`. The PIN lock says `1 minute` (singular) when N = 1, and its `429` also carries a `Retry-After` header.

### Data model (backend)
New tables: `orders` (with `ulid` UNIQUE, `invoice_no` UNIQUE, `branch_id`, `user_id`, `customer_id` nullable, `authorized_by` nullable, `business_date`, `queue_no`, `status`, the money columns above, `discount_type` (the order discount's type, or `none`), `discount_kind`, `discount_value`, `client_total_cents`, `has_total_mismatch`, `placed_at`) · `order_items` · `payments` · `stock_levels` (UNIQUE `branch_id, product_id`; `qty decimal(12,4)`, sent as an integer) · `stock_movements` (`ulid` UNIQUE; `type` limited to `sale`, `adjustment` and `opening` in this phase) · `idempotency_keys` · `sequences` (`branch_id`, `name`, `period`, `next_value`, UNIQUE on the first three). Every foreign key that reaches an order is `RESTRICT`. Orders have **no** `device_id`, `order_no` or `shift_id` yet; Phases 5 and 6 add them. Indexes follow PROJECT_MEMORY §5.4, plus `(branch_id, business_date)` on `orders`.

**Dev seed** (local only): `opening` stock movements for the `track_stock` products, Iced Tea **50** and Bottled Water **30**. **No orders are seeded**, so no sales figure is ever invented.

### App (frontend)
- **Cart** (Zustand, device state, in memory): lines hold a snapshot of the product from SQLite, plus `qty`, an optional discount and notes. Tapping an available tile adds 1, or increments an existing line for that product that has no discount and no notes. The cart also holds the order discount, an optional customer (searched through `GET /customers`), and the **pending sale ULID**.
- **Pricing** lives in one pure module that implements *Sale pricing* with `BigInt`, and is unit-tested against worked examples A and B.
- **Sell screen:** on a tablet in landscape, the cart is a **permanently visible** side panel. On phones and in portrait, a bottom bar (`Cart · n items · ₱total`) opens the cart. Staff can edit a line (qty stepper, discount, note, remove), set the order discount, attach a customer, and clear the cart. Only users with `sale.create` get a cart; everyone else sees the Phase 2 read-only screen.
- **Checkout** (`/(app)/(pos)/sell/checkout`): shows subtotal, discounts, VATable sales, VAT, VAT-exempt sales and the total. Payments: cash (quick amounts: exact, ₱100, ₱500, ₱1,000), GCash (the reference is required), split tender, and a live display of the amount due or the change. **Confirm** is disabled while offline, with the message `Sales need a connection until offline mode arrives.`
- **Approval:** when the app can tell the discount needs approval (from `AuthUser` permissions and `role.max_discount_percent`, or from the server's `422`), it shows an approver picker taken from `pin-users`, filtered by `can_approve_discounts` and `max_discount_percent`, plus a PIN pad. It then resubmits with the **same ULID**.
- **Submitting:** the ULID is generated when checkout starts and is kept until a `201` arrives. On a timeout or network error, the app shows `We couldn't confirm the sale. Retry.` and retries with the **same** ULID. A stock `422` goes back to the cart with the message shown on those lines. A checksum `422` starts a catalogue sync, re-prices the cart and shows the message. A `409` "already used for a different request" means the sale already exists: the app looks it up with `GET /orders/{ulid}` and handles it as described in Q-004.
- **Success screen:** invoice number, queue number, total, tendered, **change due** in large type, and **New sale** (which clears the cart and the ULID).
- **PIN switch** (`/(app)/switch-user`), reached from the shell: a grid of `pin-users`, then a PIN pad. On success the app swaps the token and the user just like a login. The **cart is kept**, the catalogue stays, and user-specific queries are invalidated. There is also `Use email instead` (log out, then the login screen). It needs a connection.
- **Orders module** becomes `ready` (`/(app)/(pos)/orders`, `/(app)/(pos)/orders/[ulid]`) for users with `sale.create` or `report.view`. The list defaults to **today's business date**, has a date selector, invoice search and infinite scroll. The detail screen is a receipt-style view of `Order`.
- **Admin menu:** product cards and the edit screen show `stock_qty` for `track_stock` products. An **Adjust stock** dialog (with `inventory.adjust`) offers Add, Remove or Count, with a required reason, and sends it idempotently.
- **Dashboard:** the sales card renders the real `sales` object, with an honest "No sales yet today" state when `orders_count = 0`.
- **ULIDs** are generated on the device from a cryptographically secure random source. If SDK 57 doesn't provide `crypto.getRandomValues` globally, this adds `expo-crypto`, which needs a **new EAS dev build**.

---

## Feature: Printing (Phase 4)
Status: **APPROVED** (2026-09-25)

The tablet prints the customer receipt and the kitchen and bar tickets **directly** to network thermal printers: raw ESC/POS over TCP (port 9100), with no PC, bridge or print server in between (PROJECT_MEMORY §9). Printers and receipt settings are configured on the server and cached on the device, so printing also works while the internet is down. **A printer failure never blocks, reverses or loses a sale.**

**Scope decisions (user, 2026-09-25)**
- **Pay first.** Tickets print once, when the sale completes. There are no open tabs, so there are no kitchen deltas (`order_item_prints` / `sent_qty` stay deferred). **Reprint** prints the full document, marked `*** REPRINT ***`.
- **A sales receipt, not an official receipt.** It has editable header lines, the full VAT breakdown, and editable footer lines that default to `This is not an official receipt.` There are no BIR accreditation fields.
- **No cash drawer.**

**Not in this phase:** open tabs and kitchen deltas, the cash drawer, BIR fields, Bluetooth printing, a per-device IP override, printer status queries (`DLE EOT`), and void slips.

### New permission
`settings.manage` ("Manage printers and receipt settings"), granted to **Owner** and **Manager**. That makes **15** permission slugs.

### Shared object: `Printer`
```json
{
  "id": 2,
  "name": "Kitchen",
  "role": "kitchen",
  "host": "192.168.1.60",
  "port": 9100,
  "paper_width_mm": 80,
  "is_enabled": true,
  "is_default_kitchen": true,
  "category_ids": [1, 2],
  "created_at": "2026-09-25T02:00:00Z",
  "updated_at": "2026-09-25T02:00:00Z"
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | integer | no | |
| `name` | string | no | Unique per branch among non-deleted printers (case-insensitive) |
| `role` | `"cashier" \| "kitchen" \| "bar"` | no | `cashier` prints receipts. `kitchen` and `bar` print tickets. |
| `host` | string | no | An IPv4 address or a hostname, with no scheme and no port |
| `port` | integer | no | Usually `9100` |
| `paper_width_mm` | `58 \| 80` | no | 58 mm = 32 columns and 80 mm = 48 columns on the device |
| `is_enabled` | boolean | no | A disabled printer receives no jobs |
| `is_default_kitchen` | boolean | no | The printer that receives items from categories with no route. At most one per branch, and only a kitchen or bar printer. |
| `category_ids` | integer[] | no | The categories routed to this printer, ascending. Always `[]` for cashier printers. Routes to soft-deleted categories are left out. |
| `created_at`, `updated_at` | date-time | no | `updated_at` also changes when the routes change |

### Admin: printers (permission `settings.manage`)
| Method | URI | Route name | Controller | Success |
|---|---|---|---|---|
| GET | `/api/v1/admin/printers` | `v1.admin.printers.index` | `Api\V1\Admin\PrinterController@index` | 200, paginated |
| POST | `/api/v1/admin/printers` | `v1.admin.printers.store` | `…@store` | 201 `{data: Printer}` |
| GET | `/api/v1/admin/printers/{id}` | `v1.admin.printers.show` | `…@show` | 200 `{data: Printer}` |
| PATCH | `/api/v1/admin/printers/{id}` | `v1.admin.printers.update` | `…@update` | 200 `{data: Printer}` |
| DELETE | `/api/v1/admin/printers/{id}` | `v1.admin.printers.destroy` | `…@destroy` | 204 (soft delete) |

Everything is scoped to the **caller's branch**. A printer in another branch returns `404`.

**Index:** cursor envelope, with `per_page` 1–100 (default 100) and `cursor`. It includes disabled printers, excludes soft-deleted ones, and is ordered by `name`, then `id`.

**Body fields (store; update is partial)**
| Name | Type | Store | Validation rules |
|---|---|---|---|
| `name` | string | required | `string`, `max:40`, unique per branch among non-deleted printers (case-insensitive), ignoring itself on update |
| `role` | string | required | `in:cashier,kitchen,bar` |
| `host` | string | required | `string`, `max:253`, an IPv4 address or hostname (letters, digits, hyphens and dots; no scheme, no port) |
| `port` | integer | optional (default 9100) | `integer`, `min:1`, `max:65535` |
| `paper_width_mm` | integer | optional (default 80) | `in:58,80` |
| `is_enabled` | boolean | optional (default `true`) | `boolean` |
| `is_default_kitchen` | boolean | optional (default `false`) | `boolean`. `true` on a cashier printer returns `422` on `is_default_kitchen`: `Only a kitchen or bar printer can be the default kitchen printer.` |
| `category_ids` | integer[] | optional (default `[]`) | `array`, `distinct`. Each id must be a non-deleted category (inactive is fine). A non-empty list on a cashier printer returns `422` on `category_ids`: `Receipt printers don't take categories.` |

**Rules**
- **Printer limit:** a branch can have at most **20** non-deleted printers. Creating another returns `409 { "message": "A branch can have up to 20 printers." }`.
- **Routes:** `category_ids` **replaces** this printer's routes. A category currently routed to another printer in the branch **moves** here; the move is recorded in both printers' audit changes.
- **Default kitchen printer:**
  - Setting `is_default_kitchen: true` clears it on every other printer in the branch, in the same transaction.
  - When the branch has no default, the first **enabled** kitchen or bar printer that is created or enabled becomes the default automatically.
- **Changing a printer's `role` to `cashier`** clears its routes and its default flag.
- **Deleting a printer** removes its routes and clears its default flag.
- **Audit:** `printer.created`, `printer.updated` (changed fields as `{from, to}`, including `category_ids`), `printer.deleted`.

**Errors:** `401` · `403` · `404` · `409` · `422`

### Admin: receipt settings (permission `settings.manage`)
| Method | URI | Route name | Controller | Success |
|---|---|---|---|---|
| GET | `/api/v1/admin/settings` | `v1.admin.settings.show` | `Api\V1\Admin\SettingsController@show` | 200 `{data: BranchSettings}` |
| PATCH | `/api/v1/admin/settings` | `v1.admin.settings.update` | `…@update` | 200 `{data: BranchSettings}` |

**`BranchSettings`** (the caller's branch, with defaults filled in)
```json
{
  "receipt_header_lines": ["Main Branch", "123 Rizal St., Makati", "TIN 000-123-456-000"],
  "receipt_footer_lines": ["This is not an official receipt."],
  "auto_print_receipt": true,
  "receipt_copies": 1,
  "print_kitchen_tickets": true,
  "updated_at": null
}
```
| Field | Type | Nullable | Default when never saved |
|---|---|---|---|
| `receipt_header_lines` | string[] | no | Built from the branch: its `name`, its `address` split on line breaks, and `TIN <tin>`, skipping empty values |
| `receipt_footer_lines` | string[] | no | `["This is not an official receipt."]` |
| `auto_print_receipt` | boolean | no | `true` |
| `receipt_copies` | integer 1–3 | no | `1` |
| `print_kitchen_tickets` | boolean | no | `true` |
| `updated_at` | date-time | **yes** | `null` until the settings are first saved |

**PATCH body** (partial): `receipt_header_lines` (`array`, `max:6`; each line `required`, `string`, `max:48`) · `receipt_footer_lines` (same rules) · `auto_print_receipt` (`boolean`) · `receipt_copies` (`integer`, `min:1`, `max:3`) · `print_kitchen_tickets` (`boolean`). Stored in `settings` (`branch_id`, `key`, `value` JSON). **Audit:** `settings.updated`, with the changed fields as `{from, to}`.

**Errors:** `401` · `403` · `422`

### GET /api/v1/print-config
| | |
|---|---|
| Route name | `v1.print-config` |
| Controller | `Api\V1\PrintConfigController@show` |
| Auth | yes (any user) |

Everything the device needs to print, for the **caller's branch**. It is small and bounded (at most 20 printers), so it isn't paginated.
```json
{
  "data": {
    "branch": { "id": 1, "name": "Main Branch", "timezone": "Asia/Manila" },
    "settings": { "...": "BranchSettings" },
    "printers": [ { "...": "Printer" } ],
    "generated_at": "2026-09-25T02:05:00Z"
  }
}
```
`printers` holds every **non-deleted** printer of the branch, **including disabled ones**, ordered by `name`, then `id`. **Errors:** `401`

### Order revision: `items[].category_id`
`order_items` gains a **`category_id` snapshot**: the product's category **at the time of sale**, captured by `CompleteSaleAction`. A migration backfills existing rows from their products. `Order.items[]` gains `category_id` (integer, not nullable). Routing and reprints use it, so a product that is later moved or deleted still prints at the right station.

### Dev seed (local only)
When `DEV_PRINTER_HOST` is set in `.env` (a new, optional key; see `.env.example`), DevSeeder adds three printers in MAIN:
- **Counter:** `cashier`, port 9100, 80 mm.
- **Kitchen:** port 9101, the default kitchen printer, with the routes Breakfast and Meals.
- **Bar:** port 9102, with the route Drinks.

Without the key, no printers are seeded.

### Device rules (frontend)
**Transport**
- The app uses a local Expo Module, `mobile/modules/pos-printer` (Kotlin, Android only). It exposes `send(host, port, bytes, timeoutMs)` and `probe(host, port, timeoutMs)`, behind a `PrintTransport` interface. It is loaded with `requireOptionalNativeModule`.
- **In Expo Go**, or in a build without the module, printing is unavailable and nothing is queued. The app shows `Printing needs the POS dev build. Expo Go can't connect to printers.`, and everything else keeps working.
- **Send:** connect with a **5 s** timeout, write, flush, shut down output, drain any input until EOF or 1.5 s, then close.

**ESC/POS** (an in-house builder, with no npm package)
- Init: `1B 40`, `1C 2E` (cancels Kanji mode), `1B 74 00` (code page 437).
- Text is encoded as CP437. Characters outside it are transliterated (`₱→P`, curly quotes to straight ones, dashes to `-`, `…` to `...`), and anything else becomes `?`. **Control characters are stripped** from every printed string, so notes and names can't inject commands.
- Columns: 32 at 58 mm and 48 at 80 mm. Double width halves them.
- Cut: `1B 64 03 1D 56 01`.
- Amounts print as `1,250.50`. The documents print the server's `Order` fields and **never compute money**.

**Config:** `GET /print-config` is cached in SQLite, keyed by branch and API origin, and loaded at startup.
- It refreshes on the catalogue-sync triggers (login and restore, foreground, every 5 minutes, "Sync now") and after any printer or settings change in the app.
- Offline, the device uses the cache. Logout keeps it.

**Routing**
- **Receipt printer:** each tablet chooses its own among the enabled `cashier` printers. The choice is stored on the device. It falls back to the only enabled cashier printer, then the first by name. With none, the success screen says `No receipt printer is set up for this tablet.`
- **Receipt copies:** `auto_print_receipt` on → `receipt_copies` receipt jobs. Off → a **Print receipt** button.
- **Kitchen and bar:** each item goes to its category's printer when that printer is enabled, else to the default kitchen printer when enabled. Otherwise it is listed on the success screen as **not sent to any printer**.
- **One ticket per station.** Lines with the same `(product_id, notes)` are merged. When `print_kitchen_tickets` is off, no tickets print.

**Queue** (persistent SQLite `print_jobs`)
- A first print is deduplicated per `(order_ulid, kind, printer_id, copy_no)`, so a replayed `201` or the Q-004 lookup never prints twice. Reprints are never deduplicated.
- **One lane per `host:port`**, one job at a time in each lane, with lanes running in parallel. A dead kitchen printer never delays the receipt.
- **Retries:** connect-phase errors (timeout, refused, unreachable) are retried up to **3 attempts**, at 0 s, +2 s and +4 s.
- **A write error (after bytes were sent) is never retried automatically.** The job fails with `<printer> may have printed part of this. Check before retrying.`
- When a job runs out of attempts, the other pending jobs in that lane fail at once.
- Host, port and width are read from the **current** config at send time, so fixing a wrong IP and pressing Retry works.
- **At app start**, any job left `pending` or `printing` becomes `failed` (`The app closed before this printed.`). It is **never reprinted silently**.
- Finished jobs are pruned after 1 day, and failed ones after 7 days.
- **Printing never throws into the sale flow.**

**Screens**
- **Sale complete:** the screen appears at once, as in Phase 3. Below it, one status row per job: `Sending…`, `Sent`, or failed with **Retry**. The app says **"Sent", never "Printed"**, because port 9100 gives no confirmation.
- **Sell screen:** a failure banner (`Kitchen ticket #17 didn't print: Kitchen isn't responding. [Retry] [Dismiss]`, or `Retry all` when there are several), and a **printer status pill** in the header.
  - The pill comes from a reachability probe of this tablet's receipt printer and the enabled kitchen and bar printers.
  - The probe runs when Sell is focused, at most once a minute, with a 3 s timeout, and skips busy lanes.
- **Order detail:** **Reprint**, then Receipt or Kitchen tickets (all stations). Printed documents are marked `*** REPRINT ***`.
- **Printers module** (`ready`):
  - **The list** needs `sale.create` or `settings.manage`, and works offline from the cache. Each printer has a status dot, **Test print**, and, for cashier printers, "Receipts from this tablet".
  - **Create and edit** need `settings.manage`. The form has role and width selectors, enabled and default switches, and a category picker that labels categories already routed elsewhere (e.g. "at Bar"). It can **test-print the host being edited before saving**.
- **Settings module** (`ready`, `settings.manage`): edit the header and footer lines, auto-print, copies (1–3) and kitchen tickets, with **Print sample**.

**Receipt layout** (32 or 48 columns; amounts right-aligned)
```
<header lines, centred, the first one bold>
SALES RECEIPT
*** REPRINT ***                (reprints only)
No.        INV-MAIN-00000042
Date       09/25/2026 12:12 PM (branch timezone)
Cashier    Carla Cashier
Customer   Maria Santos        (only when set)
QUEUE #17                      (centred, double size)
--------------------------------
1 x Hot Dog                80.00   (gross_cents)
  Promo 10%                -8.00   (line discount, when set)
2 x Rice Cake              90.00
  @45.00 VAT-exempt                (@unit when qty > 1; "VAT-exempt" when not vatable)
--------------------------------
Subtotal                  275.00
Order discount (Promo)    -10.00   (when set)
TOTAL                 P257.00      (bold, double height)
GCash 1012345678901       100.00   (one row per GCash payment)
Cash                      200.00   (tendered)
Change                     43.00
--------------------------------
VATable sales             152.12
VAT 12%                    18.25
VAT-exempt sales           86.63
Discount approved by Marco Manager (only when authorized_by)
<footer lines, centred>
Copy 2 of 2                        (when copies > 1)
```
**Kitchen ticket** (no prices)
```
KITCHEN                    (printer name, centred, bold)
*** REPRINT ***            (reprints only)
#17                        (centred, double size)
INV-MAIN-00000042  12:12 PM
Cashier: Carla Cashier
--------------------------------
2 x Rice Cake              (bold, double height)
1 x Hot Dog
  > No ketchup
--------------------------------
Note: <order notes, when set>
```
**Test page:** the printer's name, role, `host:port` and paper width, a column ruler, the sample text `Niño Peña é ₱`, and the time.

**Clarifications (v1.6.1, recorded from the implementation):**
- A host-resolution error (`ERR_PRINTER_HOST`) is retried like the other connect-phase errors.
- The native `send` has a 20 s write watchdog (a printer that stops reading with paper out or the cover open), and the JS side fails a send that never settles after 45 s, as a write error that is not retried.
- Test prints and Print sample go straight through the printer's lane with one attempt and are not stored in `print_jobs`.
- With auto-print off, **Print receipt** prints the configured copies once, as first prints; later copies come from Reprint.
- A sale completed before any print config has synced prints nothing and shows a notice; Reprint from Orders works once the config arrives.
- The Printers list warns when the branch has no default kitchen printer.

**Fake printer (dev):** `mobile/scripts/fake-printer.mjs` (Node `net` only) listens on the given ports (for example `9100 9101 9102`) and prints the decoded text with markers such as `[CENTER]`, `[BOLD]`, `[2x]` and `[CUT]`. It is run with `npm run fake-printer`.

---

## Feature: Table Number (Core Sale revision 2)
Status: **APPROVED** (2026-09-26)

The cashier may type an **optional table number** for a sale. It is saved on the order, printed **large on the kitchen ticket**, and also shown on the customer receipt and in Orders. It is a free label, not a table-management feature (there are no table lists, statuses or tabs).

### API
- **`POST /api/v1/orders`** body gains `table_no` (string\|null, optional): `nullable`, `string`, `max:10`, `regex:/^[A-Za-z0-9 -]+$/`. Surrounding spaces are trimmed, and an empty string is stored as `null`. Examples: `"12"`, `"A3"`, `"Patio 2"`. Invalid values return `422` on `table_no` (Laravel's default messages). It is part of the idempotency body like every other field.
- **`Order`** and **`OrderSummary`** (`GET /orders`, `GET /orders/{ulid}`, the `POST /orders` 201) gain `table_no` (string, **nullable**), placed right after `queue_no`.
- **Migration:** `orders.table_no` `varchar(10)` nullable. Existing orders are `null`.

### App
- **Cart:** an optional **Table** field in the cart panel and cart sheet, next to the customer. It is kept in the cart store and cleared with the cart and on New sale. The app validates it with the same rule and shows a `422` on `table_no` under the field.
- **Checkout:** sends `table_no`. The success screen shows `Table 12` when it's set.
- **Orders:** the card shows `Table 12` next to the queue number, and the detail screen shows it in the header. Nothing shows when it's `null`.
- **Kitchen ticket:** directly under the queue number, `TABLE 12` is **centred in double size**. When `null`, nothing is printed there.
- **Receipt:** a `Table      12` row right after the `QUEUE #17` line, when set.

---

## Feature: Offline Sales (Phase 5)
Status: **APPROVED** (2026-09-26)

The store keeps selling during an internet outage. A sale that can't reach the server is **saved on the tablet**, prints at once (the printers are on the LAN), and **syncs automatically** when the connection returns, with **zero lost and zero duplicated sales**. PROJECT_MEMORY §8 is the architecture.

**Scope decisions (user, 2026-09-26)**
- **Online first, offline fallback.** With internet, sales work exactly as in Phase 3: the server confirms, stock blocks, and the receipt shows the invoice number. Without internet, or when `POST /orders` can't reach the server, the sale is saved locally with an offline number and synced later.
- **No PIN checks offline.** Offline, only discounts within the cashier's own limit are allowed. The PIN switch needs internet, as today. No PIN data is ever stored on the device.
- **Accept and flag.** A synced offline sale is **never rejected** for price, stock, checksum or payment. The server accepts it, **flags** it, and managers work through a **Needs review** list.

**Not in this phase:**
- offline PIN switch or discount approval
- offline customer search or create
- `GET /sync/changes` (users and settings; `print-config` already covers printing)
- cart persistence
- shifts (Phase 6), voids and refunds (Phase 7)

### New permission
`order.review` ("Review flagged offline sales"), granted to **Owner** and **Manager**. That makes **16** slugs.

### POST /api/v1/devices/register
| | |
|---|---|
| Route name | `v1.devices.register` |
| Controller | `Api\V1\DeviceController@register` |
| Auth | yes (any user) |

**Body:**
- `install_id` (`required`, ULID regex as for orders): generated once per app install and stored in SecureStore.
- `name` (`required`, `string`, `max:60`): e.g. the device model.
- `app_version` (`nullable`, `string`, `max:20`).

**Behaviour:**
- Finds or creates the device with this `install_id` in the **caller's branch**. A new device gets the code `T` + its id padded to 2 digits (`T01`, `T02`, … `T123`).
- Updates `name`, `app_version` and `last_seen_at`.
- **Binds the current token** (`personal_access_tokens.device_id`).
- Writes the `device.registered` audit entry only when the device is created.

**200:** `{ "data": { "id": 1, "code": "T01", "name": "Galaxy Tab A9+" } }`.
**Errors:** `401` · `409 { "message": "This tablet is registered to another branch." }` · `422`
**Migration:** `devices.install_id` `char(26)` UNIQUE, nullable for existing rows.

### Online sales (`POST /orders`): unchanged, plus two recorded fields
The order also records `device_id` (from the token's device, or `null`) and `source: "online"`. The request is exactly as before.

### POST /api/v1/sync/orders
| | |
|---|---|
| Route name | `v1.sync.orders` |
| Controller | `Api\V1\SyncController@orders` |
| Auth | yes (permission `sale.create`). The token must be bound to a device, otherwise `409 { "message": "Register this tablet first." }` |
| Idempotent | by each order's `ulid` (no `Idempotency-Key` header) |

**Body:** `{ "orders": [OfflineOrder, …] }`, with `orders` `required|array|min:1|max:50`. Only this envelope can fail the whole request with a `422`.

**`OfflineOrder`** = the `POST /orders` body **without** `discount_authorization`, **plus**:
| Field | Type | Rules | Notes |
|---|---|---|---|
| `order_no` | string | `required`, `regex:/^[A-Z0-9]{1,8}-\d{8}-\d{4,6}$/` | `{device code}-{business date YYYYMMDD}-{daily sequence}` |
| `placed_at` | date-time | `required`, ISO 8601 | The device clock when the sale was confirmed |
| `cashier_id` | integer | `required` | The user signed in on the device at sale time |
| `items[].unit_price_cents` | integer | `required`, `integer:strict`, `min:0`, `max:100000000` | The price the device sold at (the **snapshot**) |

**Response:** `200`, one result per submitted order, **in the same order**:
```json
{ "data": [
  { "ulid": "01K6…", "status": "accepted", "order": { "...": "Order" }, "message": null },
  { "ulid": "01K7…", "status": "duplicate", "order": { "...": "Order" }, "message": null },
  { "ulid": "01K8…", "status": "rejected", "order": null, "message": "Product 999 doesn't exist." }
] }
```

**Per order, in order:**
1. **Duplicate:** an order with this `ulid` already exists in the branch → `duplicate`, with the stored `Order`. This covers retries and a sale that was committed online before a timeout.
2. **Rejected** (the order is not stored; `message` says why). Only for orders that can **never** be stored:
   - it fails field validation (the first message is used);
   - a `product_id` never existed (soft-deleted products are **fine**);
   - `cashier_id` isn't an active user of the branch with `sale.create`;
   - `customer_id` doesn't exist;
   - `order_no` was already used on this device by a different `ulid`.
3. **Accepted.** Stored in its own transaction; a failure doesn't affect the rest of the batch.
   - **Pricing:** priced with `SaleCalculator` at the **snapshot** `unit_price_cents`. Snapshots of the product name, category and cost come from the product (including soft-deleted ones).
   - **Stock:** movements are applied **even when stock goes negative** (a missing level row is created).
   - **Numbers:** `invoice_no` is allocated at ingest. `queue_no` comes from the sequence of the **business day of `placed_at`**, and `business_date` is also derived from `placed_at`.
   - **Stored as given:** `placed_at` (a future time is clamped to now, and flagged `clock_skew`), `order_no`, `device_id` from the token, `user_id` = `cashier_id`, `source: "offline"`, `synced_at` = now.
   - **Audit:** `order.completed`, with `source: "offline"`.
   - **Flags:** `needs_review = true` when any of these reasons applies. They are stored in `review_reasons`, in this order:
     - `price_changed`: any line's snapshot price differs from the product's current price, or the product is deleted, unavailable, or in a deleted or inactive category
     - `oversold`: a tracked product's level went below 0
     - `total_mismatch`: `|client_total_cents − total_cents| > 1`
     - `payment_short`: the payments sum is below the total
     - `discount_over_limit`: the cashier's role limit or `discount.apply` would have required approval
     - `clock_skew`: `placed_at` was more than 5 minutes in the future
   - Payments are stored with the Phase 3 rules. When the payments are short, they are stored **as tendered**, with change 0.

**Errors (whole request):** `401` · `403` · `409` (no device) · `422` (envelope only)

### Order changes (all `Order` and `OrderSummary` responses)
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `order_no` | string | yes | The device number for offline orders, `null` for online ones |
| `source` | `"online" \| "offline"` | no | |
| `needs_review` | boolean | no | |
| `review_reasons` | string[] | no | See the flags above; `[]` when there are none |
| `reviewed_at` | date-time | yes | |
| `reviewed_by` | `{id, name}` | yes | |
| `synced_at` | date-time | yes | When an offline order reached the server; `null` for online ones |

- **`GET /orders`** gains `needs_review` (`boolean`), using the same visibility rules.
- **Migration on `orders`:**
  - `device_id` (FK RESTRICT, nullable) and `order_no` (nullable), with UNIQUE `(device_id, order_no)`
  - `source` (default `online`), `needs_review` (default false), `review_reasons` (JSON)
  - `reviewed_at`, `reviewed_by`, `synced_at`
  - INDEX `(branch_id, needs_review)`
  - Existing rows get `source = online`, `needs_review = false` and `review_reasons = []`.

### POST /api/v1/orders/{ulid}/review
Route `v1.orders.review`, `Api\V1\OrderController@review`, permission **`order.review`**, with the same branch visibility (otherwise `404`).
- **Body:** `note` (`nullable`, `string`, `max:255`).
- **Behaviour:** sets `needs_review = false`, sets `reviewed_at` and `reviewed_by`, and writes the `order.reviewed` audit entry with the reasons and the note. `review_reasons` is kept for the record.
- **200:** `{data: Order}`.
- **Errors:** `409 { "message": "This order doesn't need review." }` · `401` · `403` · `404` · `422`

### GET /api/v1/sync/stock
Route `v1.sync.stock`, `Api\V1\SyncController@stock`, any authenticated user.
- **200:** `{ "data": { "levels": [ { "product_id": 9, "qty": 48 } ], "server_time": "2026-09-26T03:00:00Z" } }`.
- It covers **every non-deleted `track_stock` product** in the caller's branch, and a missing level counts as `0`. `qty` is an integer and can be negative. The list is ordered by `product_id`.
- It is an advisory snapshot for offline warnings only, bounded by the catalogue, so it isn't paginated.

### Dashboard
A new insight `orders_need_review` (**warning**, needs the `sales` section, i.e. `report.view`):
- Count: the branch's orders with `needs_review = true`.
- Title: `N offline sales need review`.
- Action: `orders.review`.

`order.reviewed` is left out of the activity feed, like `order.*`.

### Device rules (frontend)
**Registration**
- The app keeps an `install_id` (a ULID in SecureStore, created once). It calls `POST /devices/register` after login, after session restore, and after a PIN switch while online.
- It caches `{id, code}` on the device.
- A device that has **never** registered can't sell offline: `Connect once to set up offline sales.`

**Server reachability (v1.8.2 hardening)**
- **The app counts as online only when the device is connected *and* the server is reachable.**
  - Any HTTP response marks the server reachable.
  - A network error or timeout on any request marks it unreachable.
- **Checkout:** while the server is unreachable, sales save offline **instantly**, without waiting for a timeout. The status pill shows `Offline` ("Can't reach the server").
- **Recovery:**
  - While connected but unreachable, the app probes `GET {origin}/up` (Laravel's health route, no auth, 3 s timeout) every 15 s in the foreground.
  - When the probe succeeds, or on a network reconnect, the app requests the outbox, catalogue, print-config and stock syncs.
- **Timeouts:** `POST /orders` 8 s (a timeout falls back offline with the same ULID); `POST /sync/orders` 30 s; everything else 15 s.
- **Exception:** a tablet that has **never registered** can't save offline, so while the server looks unreachable it still sends the sale to the server. The cashier sees "Can't reach the server. This tablet isn't set up for offline sales yet, so the sale will be sent to the server." A lost device connection still blocks it, as before.
- **`GET /up` must stay enabled on the server.** It is Laravel's health route (`bootstrap/app.php`, `health: '/up'`).

**When a sale goes offline**
- The device is offline (`expo-network`), **or** `POST /orders` fails with a network error or timeout.
- In the timeout case, the **same ULID** is saved offline, so a sale the server did commit comes back as `duplicate` and is never counted twice.
- The cashier sees `No connection — sale saved on this tablet.`
- A 4xx from `POST /orders` keeps its Phase 3 handling. It never falls back to offline.

**Blocked offline**
- A discount that needs approval: `Needs a manager approval — connect to the internet.`
- Customer search and create: the picker says it needs a connection. A customer already attached stays.
- The PIN switch, as today.

**Local write (one SQLite transaction; the sale is complete when it commits)**
- **`order_counters`:** the next daily sequence for `(device code, business date)`. The business date comes from the branch timezone and day start. `order_no` = `T01-20260926-0005`.
- **`local_orders`:** `ulid`, `order_no`, the full printable order JSON, `status` (`pending|synced|needs_attention`), `server_order` JSON (after sync), `last_error`, `created_at`.
- **`outbox`:** `ulid`, `payload` (the `OfflineOrder`), `attempts`, `next_attempt_at`, `status`.
- **Advisory stock:** the `stock_cache` quantities are decremented.

The printable local order is built from the same `priceCart` result. It uses `invoice_no: null`, `order_no`, `queue_no` = the daily sequence, synthetic `items[].id` values (1..n), `source: "offline"`, and `placed_at` = now.

**Printing offline:** the same print queue. The receipt prints `No. T01-20260926-0005 (offline)`, and the kitchen ticket's big number is `T01-5` (code + sequence) in place of `#queue`. Everything else is as in Phase 4.

**Offline stock**
- Stock is **never** blocked offline.
- A line whose cart quantity exceeds the cached level shows `Only 2 left (offline estimate)`.
- The cache refreshes from `GET /sync/stock` on the catalogue-sync triggers and after each online sale.

**Sync worker (`outbox`)**
- **Single flight, FIFO:** batches of ≤50, oldest first. Backoff 1 s → 60 s with jitter on network or `5xx` errors.
- **Triggers:**
  - **reconnect** (new)
  - app foreground, login and restore
  - the 5-minute timer
  - right after each offline sale
  - **Sync now**
- **Results:**
  - `accepted` / `duplicate` mark the local order `synced`, store the server `Order`, and remove the outbox row.
  - `rejected` marks it `needs_attention` with the message. It is **never deleted**, and **Retry** re-queues it.
  - A `409` "Register this tablet first." registers the device, then retries.
  - A `401` stops the worker until someone signs in again. The outbox is **kept** through logout and user switches.
- **Status pill** (Sell header, replacing the catalogue-only pill):
  - `Synced` · `Pending (N)` · `Syncing` · `Needs attention (N)` · `Offline`
  - Tapping it opens a **Sync queue** screen that lists the pending and needs-attention sales, with **Sync now** and per-sale **Retry**.

**Orders module**
- The local `pending` and `needs_attention` orders appear **at the top** of today's list, with a badge. Their detail is read from the local JSON, with Reprint.
- Synced orders come from the API as before. A synced local order's reprint uses the server `Order`, which has the invoice number.
- **Review** (`order.review`):
  - a **Needs review** filter chip on the list;
  - the order detail shows the reasons in plain words (e.g. `Price changed during the outage`) and a **Mark reviewed** action with an optional note;
  - the dashboard insight opens that filter.

---

## Feature: Shifts & Reporting (Phase 6)
Status: **APPROVED** (2026-09-26)

Each tablet runs **cash shifts**. A shift opens with a starting cash float, and staff can record cash put into or taken out of the drawer. Closing the shift counts the drawer and prints a **Z-read**; an **X-read** can be printed at any time while the shift is open. **From this phase, a sale needs an open shift on the tablet.** Managers get **sales reports** for any date range, with **CSV export**.

**Scope decisions (user, 2026-09-26)**
- **One shift per tablet.** The tablet's cash drawer has one open shift at a time. Any cashier who PIN-switches onto the tablet sells into it, and each sale still records its own cashier.
- **Shifts work offline**, like sales. Opening, cash movements and closing are saved on the tablet, each with a ULID made there, and synced through the outbox.
- **Internal use only.** X-read and Z-read are **shift reports**, not BIR readings. There is no accumulated grand total and no reset counter.
- **Extras:** cash in / cash out, a sales reports screen, and CSV export.

**Not in this phase:** voids and refunds (Phase 7), BIR readings, denomination counting, shift handover between tablets, editing a closed shift.

### Permissions
The existing slugs are used as follows; there is no new permission.
- **`shift.open`:** open a shift, record cash in and out, print the X-read.
- **`shift.close`:** close the shift, which prints the Z-read.
- **`report.zread`:** see the shifts list and every shift's report.
- **`report.view`:** sales reports and CSV export.

### Shared object: `Shift`
```json
{
  "ulid": "01K6S…",
  "status": "closed",
  "device": { "id": 1, "code": "T01" },
  "opened_at": "2026-09-26T00:02:00Z",
  "opened_by": { "id": 3, "name": "Carla Cashier" },
  "opening_float_cents": 200000,
  "closed_at": "2026-09-26T09:05:00Z",
  "closed_by": { "id": 2, "name": "Marco Manager" },
  "counted_cash_cents": 845000,
  "close_note": null,
  "report": { "...": "ShiftReport" },
  "synced_at": "2026-09-26T09:05:03Z"
}
```
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `ulid` | string | no | Generated on the tablet |
| `status` | `"open" \| "closed"` | no | |
| `device` | `{id, code}` | no | The tablet the shift belongs to |
| `opened_at`, `opened_by`, `opening_float_cents` | | no | |
| `closed_at`, `closed_by`, `counted_cash_cents`, `close_note` | | yes | `null` while the shift is open |
| `report` | `ShiftReport` | no | **Computed live** from the shift's orders and cash movements |
| `synced_at` | date-time | no | When the server first received the shift |

**`ShiftReport`** (the X-read and the Z-read use the same shape)
```json
{
  "orders_count": 42, "items_sold": 97,
  "gross_sales_cents": 1250000, "discounts_cents": 25000, "net_sales_cents": 1225000,
  "vatable_sales_cents": 1000000, "vat_amount_cents": 120000, "vat_exempt_sales_cents": 105000,
  "by_payment_method": [ { "method": "cash", "orders_count": 30, "amount_cents": 700000 }, { "method": "gcash", "orders_count": 14, "amount_cents": 525000 } ],
  "cash_in_cents": 50000, "cash_out_cents": 105000,
  "expected_cash_cents": 845000, "variance_cents": 0,
  "by_cashier": [ { "user_id": 3, "name": "Carla Cashier", "orders_count": 30, "net_sales_cents": 900000 } ],
  "needs_review_count": 0
}
```
**Definitions:**
- **Sales figures:** sums over the shift's `completed` orders, using the same fields as the dashboard `sales` section.
- **`by_payment_method`:** always has both methods, cash first. Cash is counted **net of change**.
- **`expected_cash_cents`** = `opening_float_cents` + cash sales + `cash_in_cents` − `cash_out_cents`.
- **`variance_cents`** = `counted_cash_cents` − `expected_cash_cents`. It is `null` while the shift is open. A negative value means the drawer is short.
- **`by_cashier`:** ordered by `net_sales_cents` descending, then name.
- **`needs_review_count`:** counted on the server only. On the tablet it is always 0.

The tablet computes the same report from its own data (see *Device rules*), so a report prints offline too. The server's report is the record of truth.

### Shared object: `CashMovement`
`{ ulid, type: "in"|"out", amount_cents, reason, occurred_at, user: {id, name} }`

### Order changes
- `POST /orders` and `OfflineOrder` gain **`shift_ulid`**: `required`, ULID regex.
- `Order` and `OrderSummary` gain `shift_ulid`, a string that is `null` only for orders placed before Phase 6.
- **Online sale (`POST /orders`):** when the shift is already known to the server and is **closed**, the sale returns `422` on `shift_ulid` with `This shift is closed. Open a new shift.` A shift the server doesn't know yet is **accepted**, because its open event may still be in the outbox.
- **Offline ingest (`POST /sync/orders`):** never rejected for its shift. It adds the review reason **`shift_closed`** when the order's shift is known and was closed before the order's `placed_at`.
- `orders.shift_ulid` is `char(26)`, nullable, indexed, **with no foreign key**, because an order may arrive before its shift. Reports link orders to shifts by ULID.

### Shift endpoints
All are idempotent by the `ulid` in the body or path. A repeat gets the stored result with `200`. Everything is scoped to the caller's branch, and **the token must be bound to a device** (otherwise `409 "Register this tablet first."`). None of these writes is ever rejected for a business rule, because the tablet may have made it offline hours earlier; problems are **flagged** instead.

| Method | URI | Route name | Permission | Body | Success |
|---|---|---|---|---|---|
| POST | `/api/v1/shifts` | `v1.shifts.store` | `shift.open` | `ulid`, `opened_at` (ISO), `opened_by` (user id), `opening_float_cents` (`integer:strict`, `0–100000000`) | 201 `{data: Shift}` (a repeat returns 200) |
| POST | `/api/v1/shifts/{ulid}/cash-movements` | `v1.shifts.cash.store` | `shift.open` | `ulid`, `type` (`in\|out`), `amount_cents` (`integer:strict`, `1–100000000`), `reason` (`required`, `max:120`), `occurred_at`, `user_id` | 201 `{data: CashMovement}` |
| POST | `/api/v1/shifts/{ulid}/close` | `v1.shifts.close` | `shift.close` | `closed_at`, `closed_by` (user id), `counted_cash_cents` (`integer:strict`, `0–1000000000`), `close_note` (`nullable`, `max:255`) | 200 `{data: Shift}` |
| GET | `/api/v1/shifts` | `v1.shifts.index` | `report.zread` | query: `per_page`, `cursor`, `business_date`, `device_id`, `status` | 200, cursor list, `opened_at` desc |
| GET | `/api/v1/shifts/{ulid}` | `v1.shifts.show` | `report.zread`, **or** any user for a shift of **their own tablet** | | 200 `{data: Shift}` |

**Rules**
- **Device:** a shift belongs to the **token's device**. A cash movement or close for a shift of another device is rejected with `409 "This shift belongs to another tablet."`
- **Users:** `opened_by`, `closed_by` and `user_id` must be active users of the branch. When they aren't, the write returns `422`.
- **Two open shifts:** opening while the device already has another open shift is **accepted**. The older one is flagged `auto_closed`, and its `closed_at` becomes the new shift's `opened_at`, with no counted cash.
- **Cash movement on a closed shift:** accepted and flagged.
- **Closing twice:** the first close wins, and a repeat returns the stored shift.
- **Audit:** `shift.opened`, `shift.cash_in`, `shift.cash_out`, `shift.closed` (with the variance). These are left out of the activity feed, like `order.*`.
- **Migrations:**
  - `shifts`: `ulid` UNIQUE, `branch_id`, `device_id`, `opened_*`, `opening_float_cents`, `closed_*`, `counted_cash_cents`, `close_note`, `flags` JSON, `synced_at`, timestamps
  - `cash_movements`: `ulid` UNIQUE, `shift_ulid`, `branch_id`, `type`, `amount_cents`, `reason`, `user_id`, `occurred_at`
  - `orders.shift_ulid`
- A `Shift` also carries `flags` (a string array: `auto_closed`, `movement_after_close`), `[]` when there are none.

### Sales reports (`report.view`)
**`GET /api/v1/reports/sales`** (`v1.reports.sales`, `Api\V1\ReportController@sales`)
- **Query:**
  - `from`, `to` (`date_format:Y-m-d`, `required`; `to ≥ from`; at most **366 days**)
  - `group_by` (`required`, `in:day,product,category,payment,cashier`)
- **Scope:** the caller's branch; `completed` orders whose **business date** falls in the range.

**200:**
```json
{ "data": {
    "from": "2026-09-01", "to": "2026-09-26", "group_by": "product",
    "totals": { "orders_count": 812, "items_sold": 2104, "gross_sales_cents": 0, "discounts_cents": 0, "net_sales_cents": 0, "vat_amount_cents": 0 },
    "rows": [ { "key": "9", "label": "Iced Tea", "orders_count": 120, "qty": 310, "gross_sales_cents": 0, "discounts_cents": 0, "net_sales_cents": 0 } ]
} }
```
**Rows by `group_by`:**
| `group_by` | Rows | Key and label | Order |
|---|---|---|---|
| `day` | one per business day in the range, including 0-filled days | the date for both | ascending |
| `product` | per `product_id` | product id; label = latest name snapshot | `net_sales_cents` descending |
| `category` | per `category_id` snapshot | category id; label = latest name snapshot | `net_sales_cents` descending |
| `payment` | `cash`, then `gcash` | the method for both | fixed |
| `cashier` | per user | user id; label = name | `net_sales_cents` descending |

- **What each row counts:**
  - `qty`: items sold. It is `null` for `payment` rows.
  - **Product and category rows** use the line totals (`line_total_cents`) as net, so an order's discount is split across its lines.
  - **Payment rows** use the stored `amount_cents`, which is net of change. Their gross and discounts are `null`.
- **Size:** rows are capped at **500** and are not paginated, which bounds the report. When more rows exist, `meta.truncated` is `true`.
- **Speed:** it is aggregated in SQL, with one query per report and **no per-row queries**. It must respond in **under 500 ms** on a year of seeded data (the PROJECT_MEMORY exit criterion), with indexes added as needed.

**`GET /api/v1/reports/sales/export`** (`v1.reports.sales.export`): the same query, but it returns `text/csv` (UTF-8 with BOM) with `Content-Disposition: attachment; filename="sales-<group_by>-<from>-<to>.csv"`.
- **Columns:** the row fields plus a final `TOTAL` line. Amounts are written in pesos with 2 decimals (for example `1250.50`), because this file is for spreadsheets.
- **This is the one endpoint that doesn't return JSON.** Its errors are still JSON.

### Device rules (frontend)
**Shift gate**
- The Sell screen shows **Open a shift** (starting cash, `shift.open`) when this tablet has no open shift. Sales need an open shift.
- The Sell header shows the shift (`Shift since 8:02 AM`) with a menu: **Cash in**, **Cash out**, **X-read**, **Close shift**.

**Local storage**
- New SQLite tables `shifts` and `cash_movements`.
- **Every completed sale is now stored locally**, including online ones (as `synced`, with the server `Order`), so the tablet can compute its own shift report.
- Only the current shift and the last 7 days are kept locally. Older synced sales are pruned.

**Outbox**
- The outbox gains an `entity` column: `order`, `shift_open`, `cash_movement`, `shift_close`.
- It stays **strictly FIFO across entities**:
  - consecutive `order` rows are batched to `POST /sync/orders` (≤50);
  - shift events are sent one by one to their endpoints;
  - a shift event that the server rejects goes to **Needs attention**, like a sale.
- Shift events **always** go through the outbox, online or offline. When online, the outbox sends them at once.

**Reports on the tablet**
- The X-read and Z-read are computed **from local data**: the shift's sales and cash movements on this tablet.
- They print on the tablet's receipt printer (new document kinds `x_read` and `z_read`, 32 or 48 columns) and can be reprinted from the shift history.

**Closing a shift**
1. Enter the counted cash. The app shows expected cash and variance.
2. Confirm. The Z-read prints, and the Sell screen goes back to **Open a shift**.

**Screens**
- **Shifts** (`report.zread`): a list with a date filter, and a detail showing the server `ShiftReport` with Print.
- **Reports** (`report.view`): a date range, a `group_by` selector, a totals card and a rows table. Uses the existing charts for `day`. **Export CSV** downloads the export and opens the share sheet (`expo-file-system` + `expo-sharing`, which needs a **new EAS dev build**).
- The sidebar modules `shifts` and `reports` become ready.

---

## Feature: Voids & Refunds (Phase 7)
Status: **APPROVED** (2026-09-27)

A completed sale can be **voided** while its shift is still open, or **refunded**, in full or line by line, at any time after. Orders are **never deleted** (PROJECT_MEMORY §4.7): a void or refund is a state change plus its own records. Every reversal returns stock through reversing movements in the same transaction and is written to the audit log. Stock and revenue must **reconcile exactly** after a void and a partial refund (the Phase 7 exit criterion).

**Scope decisions (user, 2026-09-27)**
- **Manager PIN approval.** Any user with `sale.create` can start a void or refund. When that user lacks `sale.void` / `sale.refund`, a manager approves it on the same screen with their PIN, exactly like discount approval.
- **Void only within the same shift.** A sale can be voided only while **its shift is still open**, and only on **the tablet that sold it** (the cash goes back from that drawer). A printed Z-read therefore never changes. After the shift closes, the sale is refunded instead.
- **Refunds have no time limit.** Refunds can be full or partial, per line and quantity.
- **Money goes back the way it was paid.** Cash comes out of the drawer of the **refunding tablet's open shift**. GCash is sent back from the store's GCash account and its reference is recorded. A sale paid both ways is split by staff, within what each method paid.
- **The kitchen is told.** A void prints a **VOID kitchen ticket** to the stations the sale went to, plus a void slip on the receipt printer.

**Online only.** Voids and refunds need a connection, because the manager PIN is never checked offline (Phase 5 decision). A sale still waiting in the outbox (`pending` or `needs_attention`) can't be voided or refunded until it has synced.

**Not in this phase:** offline voids or refunds, exchanges, store credit, refunds to a different payment method, BIR void/refund reports, voiding a single line (use a partial refund), editing a completed sale.

### Permissions
No new slugs. `sale.void` and `sale.refund` already exist, and Owner and Manager hold them.
- **Start** a void or refund: `sale.create`, `sale.void` or `sale.refund`. The order must be visible to the caller, as for `GET /orders/{ulid}`; otherwise `404`.
- **Authority:** a caller with `sale.void` (or `sale.refund`) acts on their own authority, and no PIN is asked. Otherwise the request carries `authorization: { "user_id", "pin" }`.
- **The approver must be:** active, in the caller's branch, holding a PIN and holding `sale.void` (or `sale.refund`). The PIN goes through the shared PIN-attempt limiter (5 wrong PINs lock it for 15 minutes, `429`).
- **Errors, as for discounts:**
  - `422` on `authorization`: `A manager must approve this void.` / `A manager must approve this refund.`
  - `422` on `authorization.user_id`: `This person can't approve voids.` / `This person can't approve refunds.`
  - `422` on `authorization.pin`: `Incorrect PIN.`
  - `429` while the approver's PIN is locked.
- **`GET /auth/pin-users`** items gain `can_approve_voids` (has `sale.void`) and `can_approve_refunds` (has `sale.refund`). They are UI hints for the approver picker.

### Order changes (all `Order` responses; `OrderSummary` where noted)
- **`status`** (Order and OrderSummary): `completed` | `voided` | `refunded` | `partially_refunded`.
  - `completed → voided` (void)
  - `completed | partially_refunded → partially_refunded | refunded` (refund)
  - `refunded` = every line's full quantity has been refunded.
- **New `Order` fields:**
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `voided_at` | date-time | yes | |
| `voided_by` | `{id, name}` | yes | The user who made the void request |
| `void_reason` | string | yes | |
| `void_authorized_by` | `{id, name}` | yes | The approver when a PIN approval was used; `null` when the caller had `sale.void` |
| `refunded_cents` | integer | no | `Σ refunds[].amount_cents`, `0` when none. **Also on `OrderSummary`.** |
| `items[].refunded_qty` | integer | no | `0` when none |
| `items[].refunded_cents` | integer | no | `0` when none |
| `refunds` | `Refund[]` | no | Oldest first, `[]` when none |
- **`GET /orders`** gains a `status` filter (`in:completed,voided,refunded,partially_refunded`), with the same visibility rules.

### Shared object: `Refund`
```json
{
  "ulid": "01K6R…",
  "business_date": "2026-09-27",
  "refunded_at": "2026-09-27T05:10:00Z",
  "shift_ulid": "01K6S…",
  "refunded_by": { "id": 3, "name": "Carla Cashier" },
  "authorized_by": { "id": 2, "name": "Marco Manager" },
  "reason": "Wrong drink",
  "amount_cents": 3369,
  "vatable_sales_cents": 3008, "vat_amount_cents": 361, "vat_exempt_sales_cents": 0,
  "items": [ { "order_item_id": 103, "product_name": "Iced Tea", "qty": 1, "amount_cents": 3369 } ],
  "payments": [ { "method": "cash", "amount_cents": 3369, "reference_no": null } ]
}
```
- `business_date` is the business day **of the refund**, not of the sale.
- `authorized_by` is `null` when the caller had `sale.refund`.
- `items[]` are in the order they were sent. `payments[]` are cash first.

### Refund amounts (the server is authoritative; the app runs the same formula with `BigInt`)
For a line with `qty = n`, `line_total_cents = T`, of which `p` units were already refunded, refunding `k` more units gives:
`amount = rhu(T × (p + k), n) − rhu(T × p, n)`, with `rhu` as in *Sale pricing*.

The rounding is cumulative, so refunding a line in several parts always adds up to exactly `T`. A full refund returns exactly `total_cents`.

- **Refund amount:** `amount_cents = Σ` of the line amounts.
- **VAT split,** rounded once per refund, as in *Sale pricing* step 8:
  - `V = Σ` the amounts of vatable lines;
  - `vatable_sales_cents = rhu(V × 10000, 11200)`;
  - `vat_amount_cents = V − vatable_sales_cents`;
  - `vat_exempt_sales_cents = Σ` the amounts of non-vatable lines.

*Worked example C* (from Order example B): refunding 1 of the 3 Iced Teas on line 3 (`T = 10107`, `n = 3`, `p = 0`) gives `rhu(10107, 3) = 3369`. Refunding the other 2 later gives `10107 − 3369 = 6738`, so the line adds up to exactly `10107`. For the first refund, `V = 3369`, `vatable = rhu(33690000, 11200) = 3008` and `vat = 361`.

### POST /api/v1/orders/{ulid}/void
| | |
|---|---|
| Route name | `v1.orders.void` |
| Controller | `Api\V1\OrderController@void` |
| Auth | yes (`sale.create` or `sale.void`). The token must be bound to a device, otherwise `409 "Register this tablet first."` |
| Idempotent | **yes**: `Idempotency-Key` = a ULID the app makes when the void dialog opens |

**Body:** `reason` (`required`, `string`, `max:255`) · `authorization` (`nullable`; `user_id` `integer`, `pin` `regex:/^\d{4,6}$/`).

**Checks, in order** (after the idempotency replay; the first failure wins):
1. `403` without the permission. `404` when the order isn't visible. `422` for field validation.
2. **State** (`409`):
   - `voided`: `This sale is already voided.`
   - `refunded` / `partially_refunded`: `This sale has refunds, so it can't be voided. Refund the rest instead.`
3. **Window** (`409`):
   - the order has no `shift_ulid`, its shift is unknown, or its shift is closed: `This sale's shift is closed. Refund it instead.`
   - the shift belongs to another device: `Void this sale on the tablet that sold it (T01).`
4. **Approval** (see *Permissions*): checked outside the transaction, so a wrong PIN stays counted.

**On success (one transaction; the order row is locked and checks 2–3 are repeated under the lock):**
- The order gets `status = voided`, plus `voided_at`, `voided_by`, `void_reason` and `void_authorized_by`.
- **Stock:** one **`void`** stock movement per `track_stock` product (`qty_delta = +` the sold quantity, at the line's unit cost, referencing the order), and `stock_levels` is updated.
- **Audit:** `order.voided` (`changes: { invoice_no, total_cents, reason, authorized_by }`).
- Payments are **not** changed. A voided order simply leaves every sales figure (see *Sales figures*). The drawer's expected cash drops by its cash, which the cashier hands back.

**200:** `{ "data": Order }`. **Errors:** `401` · `403` · `404` · `409` · `422` · `429`

### POST /api/v1/orders/{ulid}/refunds
| | |
|---|---|
| Route name | `v1.orders.refunds.store` |
| Controller | `Api\V1\OrderController@refund` |
| Auth | yes (`sale.create` or `sale.refund`). The token must be bound to a device, otherwise `409 "Register this tablet first."` |
| Idempotent | **yes**: `Idempotency-Key` = the body's `ulid` |

**Body** (worked example C)
```json
{
  "ulid": "01K6R…",
  "shift_ulid": "01K6S…",
  "reason": "Wrong drink",
  "items": [ { "order_item_id": 103, "qty": 1 } ],
  "payments": [ { "method": "cash", "amount_cents": 3369, "reference_no": null } ],
  "client_refund_cents": 3369,
  "authorization": { "user_id": 2, "pin": "1234" }
}
```
| Name | Rules | Notes |
|---|---|---|
| `ulid` | ULID regex; must equal `Idempotency-Key` | The refund's id |
| `shift_ulid` | `required`, ULID regex | The **refunding** tablet's open shift |
| `reason` | `required`, `string`, `max:255` | |
| `items` | `required`, `array`, `min:1`, `max:100`; `order_item_id` values distinct | |
| `items.*.order_item_id` | `integer`, a line of **this** order | Otherwise `422`: `This line isn't part of the sale.` |
| `items.*.qty` | `integer`, `min:1` | |
| `payments` | `array`, `max:2`; at most one per method; empty only when the amount is `0` | |
| `payments.*.method` | `in:cash,gcash` | |
| `payments.*.amount_cents` | `integer`, `min:1` | |
| `payments.*.reference_no` | GCash: `required`, `max:64`, `regex:/^[A-Za-z0-9-]+$/`. Cash: `null` | The GCash transfer back to the customer |
| `client_refund_cents` | `integer`, `min:0` | The app's computed amount (the checksum) |
| `authorization` | as for voids | |

**Checks, in order** (after the idempotency replay):
1. `403`, then `404`, then `422` field validation.
2. **State** (`409`):
   - `voided`: `A voided sale can't be refunded.`
   - `refunded`: `This sale is already fully refunded.`
3. **Quantities:** a `qty` above the line's remaining quantity returns `422` on `items.{i}.qty`: `Only <n> left to refund.` Every failing line is reported at once.
4. **Checksum:** `client_refund_cents ≠ amount_cents` returns `422` on `client_refund_cents`: `The refund amount has changed. Review it.` It is exact; there is no ±1.
5. **Payments:**
   - `Σ payments.amount_cents ≠ amount_cents` returns `422` on `payments`: `The refund must add up to ₱<x>.`
   - Per method, the refunds so far plus this one can't exceed what that method paid (stored `amount_cents`, so cash is net of change). Otherwise `422` on `payments.{i}.amount_cents`: `Only ₱<x> paid by cash is left to refund.` (or `GCash`).
6. **Shift:** a shift the server knows that is **closed** returns `422` on `shift_ulid`: `This shift is closed. Open a new shift.` A shift of another device returns `409`: `This shift belongs to another tablet.` A shift the server doesn't know yet is **accepted**, as for orders.
7. **Approval:** see *Permissions*.

**On success (one transaction; the order row is locked and checks 2–5 are repeated under the lock):**
- **Records:** insert the `refunds` row, its `refund_items` and its `refund_payments`.
- **Order:** add to `order_items.refunded_qty` / `refunded_cents` and to `orders.refunded_cents`, then set `status` to `refunded` or `partially_refunded`.
- **Stock:** one **`refund`** stock movement per `track_stock` product (`+qty`, at the line's unit cost, referencing the refund). Stock always goes back.
- **Audit:** `order.refunded` (`changes: { invoice_no, refund_ulid, amount_cents, reason, authorized_by }`).
- **`business_date`** comes from the branch's business day at `refunded_at`, which is the server time.

**201:** `{ "data": Order }`, whose `refunds` includes the new one. **Errors:** `401` · `403` · `404` · `409` · `422` · `429`

### Sales figures after Phase 7 (dashboard `sales`, `ShiftReport`, sales reports)
- **Sales** count every order whose status is **not `voided`**, on the order's business day, exactly as before. A refunded sale is still a sale. This replaces "`completed` orders" wherever Phases 3 and 6 used it.
- **Voids:** `voids_count` / `voids_cents` (`Σ total_cents`) of the voided orders, on the order's business day, or in the order's shift.
- **Refunds** count on the **refund's** business day, or in the **refund's** shift:
  - `refunds_count`
  - `refunds_cents` (`Σ amount_cents`)
  - `net_after_refunds_cents` = `net_sales_cents − refunds_cents`
- Existing fields keep their meaning, so no screen that reads them breaks.

**Dashboard `sales`** gains `voids_count`, `refunds_cents` and `net_after_refunds_cents`, for today.

**`ShiftReport`** gains:
- `voids_count`, `voids_cents`: the shift's voided orders.
- `refunds_count`, `refunds_cents`: refunds whose `shift_ulid` is this shift.
- `refunds_by_method: [{method, amount_cents}]`: always both methods, cash first.
- `net_after_refunds_cents`.
- **`expected_cash_cents`** becomes `opening_float_cents` + cash sales + `cash_in_cents` − `cash_out_cents` − **cash refunds** (PROJECT_MEMORY §3.5).

**Sales reports:**
- `totals` gains `voids_count`, `voids_cents`, `refunds_count`, `refunds_cents` and `net_after_refunds_cents`.
- Every row gains `refunds_cents` and `net_after_refunds_cents`. Product and category rows also gain `refunded_qty` (`null` for other groupings).
- **Where refunds are counted:**
  - `day` rows: on the refund's day.
  - `product` and `category` rows: from `refund_items`, on the refund's day, by the line's product and category snapshot. A product refunded in the range but not sold in it still gets a row, with sales of 0.
  - `payment` rows: from `refund_payments`, by method.
  - `cashier` rows: by the **original sale's** cashier.
- **CSV** gains the columns `refunded_qty`, `refunds` and `net_after_refunds`, and the `TOTAL` line fills them.
- The 500 ms budget still applies. `refund_items` and `refund_payments` carry `branch_id` and `business_date`, as the Phase 6 report tables do.

### Data model (backend)
- **`orders`:** `voided_at`, `voided_by`, `void_reason`, `void_authorized_by` (both user columns are FK RESTRICT, nullable), and `refunded_cents` (default 0).
- **`order_items`:** `refunded_qty` and `refunded_cents` (default 0).
- **`refunds`:**
  - `ulid` UNIQUE, `order_id` (RESTRICT), `branch_id`, `business_date`, `shift_ulid` (char 26, no FK, as on orders), `device_id`
  - `refunded_by`, `authorized_by` (nullable)
  - `reason`, `amount_cents`, the three VAT columns, `refunded_at`
- **`refund_items`:** `refund_id`, `order_item_id` (both RESTRICT), `qty`, `amount_cents`, plus the report columns `branch_id`, `business_date`, `product_id`, `category_id`.
- **`refund_payments`:** `refund_id`, `method`, `amount_cents`, `reference_no`, plus `branch_id` and `business_date`.
  - A separate table, not negative `payments` rows (a deliberate change from PROJECT_MEMORY §5), so the Phase 6 payment sums stay untouched.
- **`stock_movements.type`** gains `void` and `refund`.
- **Reconciliation invariants** (tested):
  - `Σ stock_movements.qty_delta = stock_levels.qty` for every product.
  - Per order: `refunded_cents = Σ refunds.amount_cents = Σ items.refunded_cents`, and `refunded_cents ≤ total_cents`.
  - Per refund: `Σ refund_payments.amount_cents = amount_cents`.
  - Per method, refunds never exceed what that method paid.
  - A full refund returns exactly `total_cents`, and the report's `net_after_refunds_cents` for that sale is 0.

### Device rules (frontend)
**Where the actions are.** On the order detail (`/(app)/(pos)/orders/[ulid]`), for a server order the user can see:
- **Void sale:** shown when `status = completed` and the order's `shift_ulid` is **this tablet's open shift**. It is disabled offline.
- **Refund:** shown when `status` is `completed` or `partially_refunded`. It needs an open shift on this tablet and a connection.
- Offline, both say `Voids and refunds need a connection.` A local order that hasn't synced says `This sale hasn't synced yet.` and offers no action.

**Void dialog**
- A required reason, with quick picks (`Customer cancelled`, `Wrong order`, `Duplicate sale`, `Other…`).
- When the user lacks `sale.void`: an approver picker (`pin-users` filtered by `can_approve_voids`) and a PIN pad.
- Confirm (destructive) → `POST …/void`, with an `Idempotency-Key` kept until a `200` arrives. A network error or timeout shows Retry with the same key.
- After a `200`:
  1. Replace the local copy of the order, so the tablet's shift report drops it.
  2. Print the **void slip** on the receipt printer.
  3. Print a **VOID kitchen ticket** to each station the sale's lines route to, when `print_kitchen_tickets` is on.
  4. Show "Sale voided. Give back ₱157.00 cash" (and "Send back ₱100.00 GCash"). The amounts are the order's payments, from the server `Order`.

**Refund screen** (`/(app)/(pos)/orders/[ulid]/refund`)
- **Lines:** one per line with qty remaining > 0, each with a stepper (0 to remaining). **Refund everything** sets them all to the maximum.
- **Amount:** computed with *Refund amounts* (`BigInt`), with the VAT split shown.
- **Payment split:** by default cash first, up to the cash still refundable, then GCash. Staff can edit it, but not beyond what each method has left. GCash needs the reference.
- **Reason:** required.
- **Approval:** when the user lacks `sale.refund`, an approver picker (`can_approve_refunds`) and a PIN.
- **Submitting:** the refund `ulid` is made when the screen opens and kept until a `201`; a timeout means Retry with the same `ulid`.
  - A quantity or checksum `422` refetches the order and re-prices.
  - A shift `422` returns to Sell's **Open a shift**, like a sale.
- **After `201`:**
  1. Replace the local order.
  2. Store the refund locally for the shift report.
  3. Print the **refund slip**.
  4. Show "Refund done. Give back ₱33.69 cash".

**Local data**
- A new SQLite table `local_refunds`: `ulid`, `order_ulid`, `shift_ulid`, the `Refund` JSON, `created_at`.
- It is pruned like synced sales: after 7 days, except for the current shift.
- A void replaces the stored order's server `Order`, when the tablet has it.

**Tablet shift report** (X/Z-read) follows *Sales figures after Phase 7*:
- A local sale whose server `Order` is `voided` counts as a void, not a sale.
- Refunds come from `local_refunds` with the shift's ULID.
- Expected cash subtracts cash refunds.

**Printing** (new document kinds `void_slip`, `kitchen_void` and `refund_slip`, through the same queue)
- **Deduplication:** a first print is deduplicated per `(order_ulid or refund_ulid, kind, printer_id, copy_no)`. Reprints come from the order detail and are marked `*** REPRINT ***`.
- **Void slip (receipt printer, 1 copy):**
  ```
  <header lines>
  *** VOID ***                 (centred, double size)
  No.        INV-MAIN-00000042
  Sold       09/25/2026 12:12 PM · Carla Cashier
  Voided     09/25/2026 12:20 PM · Carla Cashier
  Approved by Marco Manager    (when void_authorized_by)
  Reason     Customer cancelled
  --------------------------------
  <the lines as on the receipt>
  TOTAL VOIDED            P257.00
  Cash returned           157.00   (cash amount_cents)
  GCash to return         100.00   (per GCash payment, with its reference)
  ```
- **VOID kitchen ticket** (per station; no prices):
  ```
  <printer name>
  *** VOID ***                 (centred, double size)
  #17  (or T01-5 for an offline sale)
  INV-MAIN-00000042  12:20 PM
  --------------------------------
  2 x Rice Cake    (the station's lines, as on the kitchen ticket)
  --------------------------------
  Do not prepare
  ```
- **Refund slip (receipt printer, 1 copy):**
  ```
  <header lines>
  REFUND                       (centred, double size)
  No.        INV-MAIN-00000042
  Refunded   09/27/2026 1:10 PM · Carla Cashier
  Approved by Marco Manager
  Reason     Wrong drink
  --------------------------------
  1 x Iced Tea              33.69
  --------------------------------
  TOTAL REFUND            P33.69
  Cash                      33.69
  GCash 1012345678901        0.00   (per refund payment)
  VATable sales / VAT 12% / VAT-exempt sales (from the Refund)
  <footer lines>
  ```
- **X-read / Z-read** add, after the sales section:
  - `Voids (N)` and its amount;
  - `Refunds (N)` and its amount;
  - `Net after refunds` (bold).

  In the cash drawer section, `Cash refunds` (negative) comes before Expected cash.

**Orders module**
- Status badges: `Voided`, `Refunded`, `Partly refunded`.
- A **Status** filter chip.
- The detail shows the void block (who, when, reason, approver), each refund (lines, amount, methods, who, reason), and the per-line refunded quantity. It adds Reprint → Void slip / Refund slip.

**Reports and Shifts screens** show the new fields, and the Reports table adds the Refunds and Net after refunds columns (wide screens) or the Net after refunds column (phone portrait).

---

## Feature: Inventory (v1 completion)
Status: **APPROVED** (2026-09-27)

This finishes v1 requirement #10: stock **surfaces low-stock and out-of-stock states**. Managers get an **Inventory** module with:
- a stock list;
- per-product movement history;
- stock in, count and wastage;
- a reorder level per product;
- dashboard alerts;
- an inventory report with CSV.

Cashiers see **Low / Out** badges on the Sell tiles.

**Scope decisions (user, 2026-09-27)**
- Everything above is built now, before Phase 8.
- **Low stock is set per product** by a reorder level that managers choose.

**Not in this feature:**
- ingredients, recipes, suppliers, purchase orders and weighted-average costing (v2);
- stock transfers;
- stock operations while offline.

The Inventory screens need a connection.

### Permissions (no new slugs)
- **Read** (list, history): `inventory.adjust` **or** `report.view`. Otherwise `403`.
- **Write** (stock in, count, wastage, reorder level): `inventory.adjust`.
- **Inventory report and CSV:** `report.view`.
- Owner and Manager hold all three. Cashiers hold none of them.

### Stock status (derived, never stored)
For a `track_stock` product in the caller's branch (a missing level row counts as qty `0`, reorder level `null`):
- `out` when `qty ≤ 0`;
- `low` when `reorder_level` is not `null` and `qty ≤ reorder_level`;
- `in_stock` otherwise.

### Stock movement types
`stock_movements.type` gains:
- `receipt`: stock in, positive;
- `count`: a stock count, whose delta the server works out;
- `wastage`: spoilage, negative.

`sale`, `void`, `refund`, `adjustment` and `opening` are unchanged.

**`POST /api/v1/admin/products/{id}/stock-adjustments`** gains an optional **`type`** (`in:adjustment,receipt,count,wastage`, default `adjustment`).

| `type` | Quantity field | Reason | Other rules |
|---|---|---|---|
| `adjustment` | `qty_delta` or `counted_qty` | required | Exactly the Phase 3 behaviour. A `counted_qty` sent without `type` is still recorded as `adjustment` |
| `receipt` | `qty_delta`, `min:1` | **optional** (`nullable`, `max:255`) | Optional `unit_cost_cents` (`integer`, `0–100000000`). It defaults to the product's `cost_cents` and is recorded **on the movement only**; the product's cost doesn't change in v1 |
| `count` | `counted_qty` (the Phase 3 rules, including `Stock is already <n>.`) | required | The movement is typed `count` |
| `wastage` | `qty_delta`, `max:-1` | required | Can't go below zero (the Phase 3 `422`) |

- A quantity with the wrong sign for its type returns `422` on `qty_delta`:
  - receipt: `Stock in must add stock.`
  - wastage: `Wastage must remove stock.`
- `unit_cost_cents` on any type other than `receipt` returns `422`: `Only stock in has a unit cost.`
- The response shape is unchanged; `type` reports the stored type.
- The audit entry is still `stock.adjusted`, and its `changes` gain `type`.
- Idempotency is unchanged: `Idempotency-Key` = the body's `ulid`.

### Shared object: `InventoryItem`
```json
{ "product_id": 9, "name": "Iced Tea", "sku": "DRK-001", "category": { "id": 3, "name": "Drinks" },
  "image_url": "https://…/iced-tea.jpg", "is_available": true,
  "qty": 9, "reorder_level": 10, "status": "low",
  "cost_cents": 1200, "stock_value_cents": 10800, "last_movement_at": "2026-09-27T05:10:00Z" }
```
- `qty` is an integer and can be negative.
- `stock_value_cents` = `max(qty, 0) × cost_cents`, using the product's current cost.
- `last_movement_at` is `null` when the product has no movement in the branch.

### GET /api/v1/inventory
Route `v1.inventory.index`, `Api\V1\InventoryController@index`.
- Lists the branch's **non-deleted `track_stock`** products, including unavailable ones, as a cursor list ordered by `name`, then `product_id`.
- **Query:**
  - `per_page` (1–100, default 25), `cursor`;
  - `search` (`max:100`; case-insensitive contains on name or SKU);
  - `category_id` (`integer`);
  - `status` (`in:in_stock,low,out,alerts`; `alerts` = `low` + `out`).
- **200:** the cursor envelope of `InventoryItem`. `meta.summary = { "tracked": 24, "low": 3, "out": 1 }` covers the **whole branch**, ignoring the filters, on every page.
- **Errors:** `401` · `403` · `422`

### GET /api/v1/inventory/{product}
Route `v1.inventory.show`, `Api\V1\InventoryController@show`, using the same read permission as the list (added by Q-020).
- **200:** `{ "data": InventoryItem }`.
- **Errors:** `401` · `403` · `404` (unknown or deleted) · `409 { "message": "This product doesn't track stock." }`

### GET /api/v1/inventory/{product}/movements
Route `v1.inventory.movements`, `Api\V1\InventoryController@movements`, using the same read permission.
- A product that isn't `track_stock` still shows its history. A product that doesn't exist returns `404`.
- **Query:** `per_page`, `cursor`, `type` (`in:` any movement type).
- **Order:** newest first (`occurred_at` desc, then id desc).
- **Items:**
```json
{ "ulid": "01K6…", "type": "receipt", "qty_delta": 24, "qty_after": 33, "unit_cost_cents": 1200,
  "reason": "Delivery", "occurred_at": "2026-09-27T02:00:00Z", "created_by": { "id": 2, "name": "Marco Manager" },
  "reference": null }
```
- **`qty_after`:** the product's branch level right after this movement. It is a running balance over the **whole** ledger (a SQL window function in `occurred_at`, id order), whatever the `type` filter or page.
- **`reference`:** `null`, or `{ "kind": "order" | "refund", "ulid": <the order's ulid>, "label": <invoice_no, or order_no when the invoice is null> }` for sale, void and refund movements.
- **Errors:** `401` · `403` · `404` · `422`

### PUT /api/v1/inventory/{product}/reorder-level
Route `v1.inventory.reorder-level`, `Api\V1\InventoryController@reorderLevel`, permission `inventory.adjust`.
- **Body:** `reorder_level` (`present`, `nullable`, `integer`, `0–100000`). `null` turns the alert off.
- **Behaviour:**
  - Stored on `stock_levels`, whose row is created when missing.
  - Writes the `stock.reorder_level_changed` audit entry (`changes: { reorder_level: { from, to } }`) only when the value changes.
- **200:** `{ "data": InventoryItem }`.
- **Errors:** `401` · `403` · `404` · `409 { "message": "This product doesn't track stock." }` · `422`

### GET /api/v1/reports/inventory
Route `v1.reports.inventory`, `Api\V1\ReportController@inventory`, permission `report.view`.
- **Query:**
  - `from`, `to` (`date_format:Y-m-d`, required, `to ≥ from`, at most 366 days, counted inclusively as in Q-013);
  - `category_id?`;
  - `status?` (`in:in_stock,low,out,alerts`, applied to the **current** status).
- **Period:** movements whose `occurred_at` falls from the start of the `from` business day to the end of the `to` business day (branch timezone and day start). `opening_qty` is the ledger sum before that start.
```json
{ "data": {
    "from": "2026-09-27", "to": "2026-09-27",
    "totals": { "tracked": 24, "low": 3, "out": 1, "stock_value_cents": 1250000, "received": 48, "sold": 97, "returned": 2, "wasted": 3, "adjusted": -1 },
    "rows": [ { "product_id": 9, "name": "Iced Tea", "category_name": "Drinks",
                "opening_qty": 35, "received": 24, "sold": 50, "returned": 1, "wasted": 1, "adjusted": 0, "closing_qty": 9,
                "reorder_level": 10, "status": "low", "unit_cost_cents": 1200, "stock_value_cents": 10800 } ]
  },
  "meta": { "truncated": false } }
```
- **Row fields:**
  - `received` = Σ receipt
  - `sold` = −Σ sale
  - `returned` = Σ void + refund
  - `wasted` = −Σ wastage
  - `adjusted` = Σ adjustment + count + opening (can be negative)
- **Invariant:** `opening_qty + received − sold + returned − wasted + adjusted = closing_qty`.
- **Current values:** `status`, `reorder_level`, `unit_cost_cents` (the product's current cost) and `stock_value_cents` describe **now**, not the end of the period.
- **Rows:** every tracked product matching the filters, including those with no movements; ordered by name, then id; capped at **500** with `meta.truncated`.
- **Totals:**
  - `received`, `sold`, `returned`, `wasted` and `adjusted` are summed over every product matching the filters, even when the rows are truncated (Q-022);
  - `tracked`, `low`, `out` and `stock_value_cents` are for the whole branch.
- **Queries:** set-based SQL with conditional aggregation, no per-row queries, and **under 500 ms** on a year of seeded movements.
- **Errors:** `401` · `403` · `422`

**`GET /api/v1/reports/inventory/export`** (`v1.reports.inventory.export`)
- Takes the same query and returns CSV, following the Phase 6 conventions: UTF-8 with BOM, CRLF, pesos with 2 decimals, and errors still in JSON.
- `Content-Disposition: attachment; filename="inventory-<from>-<to>.csv"`.
- **Header:** `product_id,name,category,opening_qty,received,sold,returned,wasted,adjusted,closing_qty,reorder_level,status,unit_cost,stock_value`.
- The last line is `TOTAL,,,,<received>,<sold>,<returned>,<wasted>,<adjusted>,,,,,<stock_value>`.

### Alerts
**Dashboard insights**, shown to users with `inventory.adjust` or `report.view`:
| Key | Severity | Title | Action |
|---|---|---|---|
| `stock_out` | critical | `N products are out of stock` (singular: `1 product is out of stock`) | `inventory.alerts` |
| `stock_low` | warning | `N products are running low` (singular: `1 product is running low`) | `inventory.alerts` |

Counts use the *Stock status* definition (a product that is `out` isn't also counted as `low`). An insight with a count of 0 is left out, as for every insight. `DescribeAuditEntries` words the new entries, e.g. `Received 24 "Iced Tea"`, `Wasted 1 "Iced Tea"`, `Counted "Iced Tea" (35 → 33)`, `Set reorder level of "Iced Tea" to 10`.

**`GET /api/v1/sync/stock`** levels gain `reorder_level` (integer or `null`): `{ "product_id": 9, "qty": 9, "reorder_level": 10 }`.

### Data model (backend)
- `stock_levels.reorder_level`: unsigned int, nullable.
- `stock_movements.type` enum gains `receipt`, `count` and `wastage`.
- An index for the report: `(branch_id, occurred_at, product_id, type)` (or the covering variant the agent finds fastest).

### Device rules (frontend)
**Module and navigation**
- The sidebar's `inventory` becomes **ready** (`/inventory`), visible with `inventory.adjust` or `report.view`.
- The admin route group lets these users in.
- The dashboard insight action `inventory.alerts` opens the list with the **Low & out** filter.

**Inventory list** (`/inventory`)
- **Header:** `ListHeader` "Inventory" with the subtitle `24 tracked products`.
- **Filters:** a segmented filter `All · Low (3) · Out (1)` from `meta.summary`, where Low selects `status=low` and Out selects `out`, plus the `alerts` view from the dashboard. There is also a pill search and category chips.
- **Cards:** image, name, category, a big `qty`, a status chip (`In stock` neutral, `Low` warning, `Out` danger), `Reorder at 10` (or `No reorder level`), and the stock value.
- Tapping a card opens the detail.
- Every list state is handled, and offline it shows `Inventory needs a connection.`

**Product detail** (`/inventory/[productId]`)
- **Summary card:** qty on hand, status, reorder level with **Edit** (a dialog with the number and **Remove**, `inventory.adjust`), stock value and cost.
- **Actions** (`inventory.adjust`), each a dialog that reuses the Phase 3 adjustment flow (the ULID is kept until a `201`, and a network error shows Retry with the same body):
  - **Stock in:** quantity, unit cost in pesos (prefilled from the product cost), optional note.
  - **Count:** counted quantity, reason.
  - **Wastage:** quantity, reason quick picks (`Spoiled`, `Expired`, `Damaged`, `Other…`).
- **History** (infinite list):
  - a type icon and label (`Stock in`, `Sale`, `Void`, `Refund`, `Wastage`, `Count`, `Adjustment`, `Opening`);
  - the signed quantity;
  - `→ 33 on hand` (`qty_after`);
  - who and when (branch timezone), and the reason;
  - a sale, void or refund shows its `reference.label`, which opens the order.
- **Filter:** a type chip.
- **Refresh:** after any write, the summary and the history both refresh, and the app requests a stock sync so the Sell badges update.

**Sell tile badges**
- `stock_cache` gains `reorder_level` (SQLite migration).
- For a `track_stock` product, the tile shows `Out` (danger chip) when the cached `qty ≤ 0`, or `Low · 3 left` (warning chip) when it is at or below the reorder level.
- **Tiles stay tappable.** An online sale is still blocked by the server's stock check (Phase 3), and offline sales never block (Phase 5).
- The badge updates whenever the cache refreshes (`stockVersion`).

**Reports**
- The Reports screen gains a `Sales | Inventory` switch.
- **Inventory view:**
  - the same date range controls, with `category` and `status` filters;
  - a totals card: tracked, low, out, stock value, received, sold, wasted;
  - the rows table: every column on wide screens; name, closing qty and status on phone portrait;
  - the truncated banner;
  - **Export CSV**, through the same share flow, with the share dialog titled `Export inventory report` (`shareCsv` gains a `dialogTitle` parameter).

---

## Feature: Senior Citizen / PWD Discount
Status: **APPROVED** (2026-09-28, with VAT exemption optional per sale)

The Philippine **Senior Citizen** (RA 9994) and **PWD** (RA 10754) discount.
- The eligible part of a sale gets **20% off**.
- When the cashier ticks **VAT exempt** for that sale, the 12% VAT is first removed from the VAT-inclusive price and the 20% comes off the VAT-exclusive amount. The eligible part is then VAT-exempt.
- It is a legal entitlement, so it is **not** a discretionary discount.

**Scope decisions (user, 2026-09-28)**
- **Any cashier can apply it, with no manager PIN and no role limit.** It works **offline** as well.
- **Two ways to apply it:**
  - **Their items:** the cashier ticks the lines the senior/PWD will consume.
  - **Shared meal:** the eligible share is `bill ÷ diners × number of SC/PWD`.
- **No double discount.** A line with SC/PWD can't carry another discount. An order with SC/PWD can't have an order discount. A shared-meal order can't have any other discount at all.
- **ID number only.** The cashier records each SC/PWD's OSCA or PWD ID number. It prints on the receipt with a signature line.
- **VAT exemption is optional, per sale, and off by default.** The SC/PWD sheet has a **VAT exempt** checkbox, unticked by default. Unticked means only the 20% comes off, and the lines stay VAT-able.

**Not in this feature:**
- the 5% discount on basic necessities (a grocery rule, not for restaurants);
- the customer's name or TIN;
- BIR SC/PWD sales books (the POS is internal-only).

### Request: `sc_pwd` (on `POST /orders` and `OfflineOrder`)
```json
"sc_pwd": {
  "mode": "items",
  "persons": [ { "type": "senior_citizen", "id_no": "OSCA-12345" } ],
  "diners": null,
  "vat_exempt": true
}
```
| Field | Rules | Notes |
|---|---|---|
| `sc_pwd` | `nullable`, object | `null` or omitted means no SC/PWD |
| `sc_pwd.mode` | `required_with:sc_pwd`, `in:items,headcount` | |
| `sc_pwd.persons` | `required_with:sc_pwd`, `array`, `min:1`, `max:10` | One entry per SC/PWD |
| `sc_pwd.persons.*.type` | `in:senior_citizen,pwd` | |
| `sc_pwd.persons.*.id_no` | `required`, `string`, `max:30`, `regex:/^[A-Za-z0-9\/ -]+$/`; distinct within the order | The OSCA or PWD ID number |
| `sc_pwd.diners` | `headcount`: `required`, `integer`, `min:` persons count, `max:100`. `items`: must be `null` | The number of people sharing the bill |
| `sc_pwd.vat_exempt` | `required_with:sc_pwd`, `boolean` | Whether the eligible part is VAT-exempt (step B). The app's default is `false` |
| `items.*.sc_pwd` | `boolean`, default `false`. **`items` mode only:** at least one line must be `true`. `headcount`: must be `false` | Marks the lines the SC/PWD consumes |

**Validation** (`422`, together with the other field errors):
- `items.{i}.discount` on a line with `sc_pwd: true`, any line discount in `headcount` mode, or an order `discount` with `sc_pwd` set: `SC/PWD can't be combined with another discount.`
- `items` mode with no line marked: on `items`, `Tick the items for the senior citizen or PWD.`
- `items.{i}.sc_pwd: true` without `sc_pwd`: `The selected sc pwd is invalid.`
- `senior_citizen` and `pwd` stay invalid as a **discount `type`**. SC/PWD only goes through `sc_pwd`.

**Approval:** SC/PWD **never** needs approval. The *Discount rules* approval check uses only the regular discounts: `line_discounts_cents + order_discount`, compared with `subtotal_cents`. Offline ingest's `discount_over_limit` flag uses the same regular discounts.

### Pricing (extends *Sale pricing*; all integers, `rhu` as defined there; the app computes with `BigInt`)
Constants:
- VAT rate `r` = `config('pos.vat_rate_bps')` (`1200`);
- SC/PWD rate `s` = `config('pos.sc_pwd_discount_bps')` (`2000`).

Steps 1–6 of *Sale pricing* run first. With SC/PWD, `D = 0` and eligible lines have no line discount, so for them `net = gross`.

**A. Eligible gross per line (`E_i`)**
- `items` mode: `E_i = gross_i` for marked lines, and `0` otherwise.
- `headcount` mode, with `p` = number of persons and `d` = diners:
  - `E_total = rhu(subtotal × p, d)`;
  - `E_i` = `E_total` allocated to the lines pro rata to `gross_i`, by the largest remainder (step 5's method).

**B. VAT relief** (only when `vat_exempt` is `true`)
- `EV = Σ E_i` of VAT-able lines, and `EX = Σ E_i` of non-VAT-able lines.
- **When `vat_exempt` is `true`:**
  - `base = rhu(EV × 10000, 10000 + r)`;
  - **`R = EV − base`** (the VAT removed);
  - `R` is allocated to the **VAT-able** lines pro rata to `E_i` (largest remainder), giving `R_i`. Non-VAT-able lines get `R_i = 0`.
- **When `vat_exempt` is `false`:** `base = EV`, `R = 0`, and every `R_i = 0`.

**C. SC/PWD discount**
- **`S = rhu((base + EX) × s, 10000)`**.
- `S` is allocated to the eligible lines pro rata to `E_i − R_i` (largest remainder), giving `S_i`.

**D. Line and order totals**
- `line_total_i = net_i − order_discount_share_i − R_i − S_i`.
- `discount_cents = line_discounts_cents + D + R + S`. So `total = subtotal − discount_cents = Σ line_total` still holds, and every existing report identity is kept.

**E. VAT** (replaces step 8, and reduces to it when there is no SC/PWD)
- A line's **exempt part** `X_i` = `E_i − R_i − S_i` when `vat_exempt` is `true`, and `0` otherwise (the eligible part then stays taxable).
- `T = Σ` over VAT-able lines of `line_total_i − X_i`: the taxable amount.
- `vatable_sales_cents = rhu(T × 10000, 10000 + r)`.
- `vat_amount_cents = T − vatable_sales_cents`.
- `vat_exempt_sales_cents = total − T`.

**Worked example D (`items` mode, one senior, `vat_exempt: true`).** Lines 1 and 2 are marked.

| Line | Item | Gross | VAT-able | E | R_i | S_i | Line total |
|---|---|---|---|---|---|---|---|
| 1 | Meal ₱250.00 × 1 (marked) | 25000 | yes | 25000 | 2679 | 4464 | 17857 |
| 2 | Iced Tea ₱45.00 × 1 (marked) | 4500 | yes | 4500 | 482 | 804 | 3214 |
| 3 | Meal ₱250.00 × 1 | 25000 | yes | 0 | 0 | 0 | 25000 |

- `EV = 29500`, `base = 26339`, `R = 3161`, `S = rhu(26339 × 2000, 10000) = 5268`.
- `subtotal 54500 · discount 8429 · total 46071`.
- `T = 25000` → `vatable_sales 22321 · vat 2679 · vat_exempt 21071`.
- The senior pays **₱210.71** (= ₱295 ÷ 1.12 × 0.8).

**Worked example F (example D's cart with `vat_exempt: false`).**
- `base = EV = 29500`, `R = 0`, `S = rhu(29500 × 2000, 10000) = 5900`, allocated by `E_i` as `5000` and `900`.
- Line totals: `20000 · 3600 · 25000`.
- `subtotal 54500 · discount 5900 · total 48600`.
- `T = 48600` → `vatable_sales 43393 · vat 5207 · vat_exempt 0`.
- The senior pays **₱236.00** (= ₱295 × 0.8).

**Worked example E (`headcount` mode, 4 diners, 1 senior, `vat_exempt: true`).**

| Line | Item | Gross | VAT-able | E | R_i | S_i | Line total |
|---|---|---|---|---|---|---|---|
| A | Platter ₱800.00 × 1 | 80000 | yes | 20000 | 2143 | 3572 | 74285 |
| B | Soda ₱120.00 × 2 | 24000 | yes | 6000 | 643 | 1071 | 22286 |
| C | Rice cake ₱60.00 × 1 | 6000 | no | 1500 | 0 | 300 | 5700 |

- `E_total = rhu(110000 × 1, 4) = 27500`.
- `EV = 26000`, `EX = 1500`, `base = 23214`, `R = 2786`, `S = rhu(24714 × 2000, 10000) = 4943`.
- `subtotal 110000 · discount 7729 · total 102271`.
- `T = 78000` → `vatable_sales 69643 · vat 8357 · vat_exempt 24271`.
- The senior's share is ₱197.71.

Both sides must test against examples D, E and F.

**Refunds (Phase 7) with SC/PWD**
- The refund amount formula is unchanged: it works on `line_total`.
- **Refund VAT split:** `V` uses each VAT-able line's taxable part `τ_i = line_total_i − X_i`, with the same cumulative formula, **clamped to the line's refund amount** (Q-024): `v_i = min(amount_i, rhu(τ × (p + k), n) − rhu(τ × p, n))`. The rest of the line's refund is VAT-exempt, so the refund's `vat_exempt_sales_cents = Σ amount − V`.

### Response changes (`Order`; the offline printable order has the same fields)
- **`sc_pwd`:** `null` or `{ mode, persons: [{type, id_no}], diners, vat_exempt, vat_relief_cents: R, discount_cents: S }`.
- **`items[]`** gain:
  - `sc_pwd` (boolean: marked, or given any share in `headcount` mode);
  - `sc_pwd_eligible_cents` (`E_i`);
  - `sc_pwd_vat_relief_cents` (`R_i`);
  - `sc_pwd_discount_cents` (`S_i`).
- **`OrderSummary`** gains `has_sc_pwd` (boolean).
- **`discount_cents`** includes `R + S`. `line_discounts_cents` stays the regular line discounts only.
- **Audit:** `order.completed` `changes` gain `sc_pwd: { mode, persons_count }`. ID numbers are stored on the order, not in the audit log.

### Reports
- **Product and category rows:** the line discounts become `line_discount + order_discount_share + R_i + S_i`, so gross − discounts = net still holds.
- **`ShiftReport`, sales report `totals` and dashboard `sales`** gain:
  - `sc_pwd_orders_count`
  - `sc_pwd_vat_relief_cents`
  - `sc_pwd_discount_cents`

  These cover non-voided orders, by the same scope rules as the other sales figures.
- **The X/Z-read** prints `SC/PWD (N)`, `VAT exempted` (when not 0) and `SC/PWD discount` after Discounts.

### Data model (backend)
- **`orders`:**
  - `sc_pwd_mode` (nullable), `sc_pwd_diners` (nullable), `sc_pwd_vat_exempt` (bool, default false);
  - `sc_pwd_persons` (JSON, nullable);
  - `sc_pwd_vat_relief_cents` and `sc_pwd_discount_cents` (default 0).
- **`order_items`:** `is_sc_pwd` (bool), plus `sc_pwd_eligible_cents`, `sc_pwd_vat_relief_cents` and `sc_pwd_discount_cents` (default 0).
- **Config:** `config('pos.sc_pwd_discount_bps', 2000)`.
- **Performance:** the existing report indexes cover the new sums. The Phase 6 performance tests must still pass.

### Device rules (frontend)
**Cart and checkout**
- An **SC/PWD** action opens a sheet with:
  - **persons:** add one or more, each with a type (`Senior citizen` or `PWD`) and an **ID number** (required);
  - **mode:** `Their items` (tick lines in the cart) or `Shared meal` (a diners stepper, at least the persons count);
  - **VAT exempt:** a checkbox, **unticked by default** for every new SC/PWD entry, with the hint `Remove the 12% VAT before the 20% discount`.
- **Other discounts:**
  - Discount controls are hidden or disabled on marked lines, and the order discount is disabled.
  - In `Shared meal`, every discount control is disabled.
  - Applying SC/PWD over existing conflicting discounts asks to remove them first.
- **Display:** marked lines show an `SC/PWD` chip. The totals show `VAT exempted −31.61` (only when VAT exempt is ticked) and `SC/PWD discount (20%) −52.68`.
- **Pricing:** it lives in the shared pricing module (`BigInt`), unit-tested against examples D, E and F. The server `422`s are shown on their fields.
- **No approval step for SC/PWD**, online or offline. An offline sale carries `sc_pwd` in its `OfflineOrder`.

**Receipt** (added to the Phase 4 layout)
- A marked line prints `  SC/PWD` under it.
- After the subtotal:
  ```
  VAT exempted (SC/PWD)      -31.61   (only when vat_exempt)
  SC/PWD discount 20%        -52.68
  ```
- Before the footer:
  ```
  Senior citizen  ID OSCA-12345   (one line per person; "PWD" for PWD)
  Shared by 4 diners, 1 SC/PWD    (headcount mode only)
  Signature: ____________________
  ```
- The VAT section already prints `VAT-exempt sales`, which now includes the SC/PWD part.
- Kitchen tickets are unchanged.

**Orders detail** shows the SC/PWD block (mode, persons with their IDs, and the amounts), and the chip on marked lines.

---

## Feature: Ingredients, Recipes & Purchasing
Status: **APPROVED** (2026-09-28)

This feature adds four things:
- **Ingredients** with one base unit and exact unit conversions;
- **Suppliers**;
- **Purchasing:** purchase request (PR) → purchase order (PO) → receiving;
- **Recipes**, which deduct ingredients when a sale is confirmed.

It replaces the legacy design (browser-only float conversions, whole-PR approval, overwritten received quantities, no authorization). PROJECT_MEMORY §3.7, §4.6 and §4.8 are updated to match.

**Scope decisions (user, 2026-09-28)**
- **PR decisions:** each PR item is approved or declined on its own, and a decline **needs a reason**. A partly declined PR still becomes a PO for its approved items.
- **One PO per PR.** Every line keeps its own supplier.
- **Approvers:** only an Owner or Admin approves PRs and POs. **The Owner may approve their own** (it is logged); nobody else may.
- **Receiving:** per line, with Pending / Partial / Complete / **Over-received**. The PO shows Not / Partially / Fully Received. Receipts are append-only and form the audit trail.
- **Shortages:** an ingredient shortage **never blocks a sale**. Stock may go negative, and alerts show.
- **Reversals:** a **void returns** recipe ingredients to stock. A **refund records them as wastage.**
- **Units and product stock:** "apply the better solution", as designed below.

**Build order:**
- **Round A:** units, ingredients, suppliers, the ledger generalisation, ingredient inventory, purchasing, the report, the insights.
- **Round B:** product stock modes, recipes, depletion.

Both rounds follow this one contract. **All purchasing and ingredient screens need a connection.**

### A. Units

**Base units.** Every ingredient has exactly one **base unit**:
- `g` (dimension `mass`);
- `mL` (`volume`);
- `pc` (`count`).

Stock, cost, recipes and the ledger are stored **only** in the base unit.

**Unit catalog** (`GET /api/v1/units`, any user, seeded and read-only). Every factor is exact:
| Code | Name | Dimension | `factor_to_base` |
|---|---|---|---|
| `mg` | Milligram | mass | 0.001 |
| `g` | Gram | mass | 1 |
| `kg` | Kilogram | mass | 1000 |
| `oz` | Ounce | mass | 28.349523125 |
| `lb` | Pound | mass | 453.59237 |
| `mL` | Milliliter | volume | 1 |
| `L` | Liter | volume | 1000 |
| `tsp` | Teaspoon | volume | 4.92892159375 |
| `tbsp` | Tablespoon | volume | 14.78676478125 |
| `fl oz` | Fluid ounce | volume | 29.5735295625 |
| `cup` | Cup (US) | volume | 236.5882365 |
| `pt` | Pint | volume | 473.176473 |
| `qt` | Quart | volume | 946.352946 |
| `gal` | Gallon | volume | 3785.411784 |
| `pc` | Piece | count | 1 |
| `dozen` | Dozen | count | 12 |
| `half dozen` | Half dozen | count | 6 |

Menu sizes (Regular, Large, Solo…) are **not** units.

**Ingredient units** (`ingredient_units`): `{ name, factor }`, where 1 `name` = `factor` × **the ingredient's base unit**. For example, on Flour (`g`): `sack` = 25000, `cup` = 120.
- `name`: `max:20`, unique per ingredient (case-insensitive).
- `factor`: a decimal greater than 0, at most 1,000,000, with up to 10 decimals.
- **Rule:** an ingredient unit may **not** reuse a catalog code of the ingredient's own dimension, e.g. `kg` on a `g` ingredient: `"kg" is already a standard unit.` It **may** reuse a code from another dimension. That is how a density is written: `cup = 120` g of flour.

**Valid units for an item**
- **Ingredient:** the catalog units of its dimension, plus its own units. An ingredient unit that reuses a catalog code takes precedence for that ingredient.
- **An `own`-stock product:** `pc` only (factor 1).
- **Anything else:** `422` on the unit field, `Add "<unit>" to <name>'s units first.`

**Quantities and conversion** (the server is the authority; it uses exact decimal math, bcmath or `brick/math`; the app mirrors it with `BigInt` for previews)
- In requests, a quantity is `{ "qty": "<decimal>", "unit": "<code>" }`. `qty` is a JSON string (or number) with **at most 3 decimals**. It is `> 0`, or `≠ 0` where corrections are allowed, and at most `1000000`.
- **`base_qty = round_half_up(qty × factor, 3)`**, in base units.
- Every stored quantity keeps both the entered `qty` + `unit` and `base_qty`.
- Ingredient quantities in responses are **strings with exactly 3 decimals** (`"25000.000"`). Product quantities stay integers.

*Worked example G (conversions):*
| Ingredient (base) | Entered | `base_qty` |
|---|---|---|
| Flour (g) | 2 `sack` | `50000.000` |
| Flour (g) | 1.5 `cup` | `180.000` |
| Flour (g) | 8 `oz` | `226.796` (226.796185) |
| Milk (mL) | 1 `cup` | `236.588` (236.5882365) |
| Milk (mL) | 2 `tbsp` | `29.574` (29.5735295625) |
| Flour (g) | 3 `tbsp` | `422 Add "tbsp" to Flour's units first.` |

### B. Stock, value and weighted-average cost
**Ledger shape**
- `stock_levels` and `stock_movements` gain a nullable `ingredient_id` beside a **now-nullable** `product_id`. Exactly one of them is set (a CHECK constraint, and the actions).
- `stock_levels` gains UNIQUE `(branch_id, ingredient_id)`.
- The product-based Inventory endpoints are unchanged.

**Ingredient levels**
- `qty` in base units (3 decimals);
- `reorder_level` (base units, 3 decimals, nullable);
- **`avg_cost`**: centavos per base unit, `DECIMAL(20,6)`. This is a **rate**; every stored amount stays in integer centavos.

**Movements**
- `qty_delta` (base units);
- `entered_qty` + `entered_unit`;
- `unit_cost_cents` (for a receipt, the entered unit's price);
- **`value_cents`**: signed integer, the value moved.

**How cost moves**
- **Receipt** of `b` base units costing `c` centavos, with `q = max(qty_before, 0)`:
  - `avg_cost = round_half_up((q × avg_cost + c) / (q + b), 6)`;
  - the movement's `value_cents = c`.
- **Consumption, wastage, or a negative adjustment** of `b`: `value_cents = −round_half_up(b × avg_cost, 0)`, and `avg_cost` is unchanged.
- **Positive adjustment or count increase:** valued at the current `avg_cost`, which is unchanged.
- **Void return** of an ingredient: valued at the snapshot cost `c`. `avg_cost` is re-weighted with the receipt formula (Q-032).
- **Stock value** = `round_half_up(max(qty, 0) × avg_cost, 0)`.
- **Status** (as in Inventory): `out` when qty ≤ 0, `low` when qty ≤ `reorder_level`, otherwise `in_stock`.

*Worked example H (weighted average):*
1. Flour on hand is `5000.000` g at `avg_cost 4.000000`.
2. A receipt of 1 `sack` @ ₱1,200.00: `b = 25000.000`, `c = 120000`.
3. `avg_cost = (5000 × 4 + 120000) / 30000 = 4.666667`. Qty is `30000.000` and the value is **₱1,400.00**.
4. Then 240 g is consumed: `value_cents = −round(240 × 4.666667) = −1120`.

### C. Suppliers
Admin CRUD, following the admin CRUD pattern (permission **`supplier.manage`**; list and read with any purchase permission).
- **Routes:** `GET/POST /api/v1/admin/suppliers`, `GET/PATCH/DELETE /api/v1/admin/suppliers/{id}`.
- **Fields:**
  - `name` (required, max 120, unique among non-deleted);
  - `contact_person`, `contact_number` (max 30), `email`, `address` (max 255);
  - `is_active`.
- **Delete:** soft delete. It returns `409 "This supplier is on purchase orders. Deactivate it instead."` when the supplier is used on any PR or PO.
- **List:** cursor, `search` (name or contact), `is_active`. Audit `supplier.*`.

### D. Ingredients
Admin CRUD (permission **`product.manage`**; reads also allowed with `inventory.adjust`, any purchase permission, or `report.view`).
- **Routes:** `GET/POST /api/v1/admin/ingredients`, `GET/PATCH/DELETE /api/v1/admin/ingredients/{id}`, plus a multipart image like products.
- **Fields:**
  - `name` (required, max 120, unique among non-deleted);
  - `base_unit` (`in:g,mL,pc`; **immutable once the ingredient has any movement, recipe line or PO line**: `409 "The base unit can't change once the ingredient is in use."`);
  - `image`, `is_active`;
  - `units: [{id?, name, factor}]`, replaced as a set.
- **Units in use:** a unit used on an open (not fully received) PO line can't be removed or have its factor changed: `409`.
- **Delete:** soft delete, blocked (`409`) while the ingredient is on a recipe or an open PO.
- **`Ingredient`:**
  - `{id, name, base_unit, image_url, is_active, units[{id,name,factor}]}`;
  - plus, for the caller's branch: `qty`, `reorder_level`, `status`, `avg_cost` (string), `stock_value_cents`, `last_movement_at`.
- **Ingredient inventory** mirrors *Inventory (v1 completion)*:
  - `GET /api/v1/inventory/ingredients` (cursor, `search`, `status`, `meta.summary {tracked, low, out}`);
  - `GET /api/v1/inventory/ingredients/{id}`;
  - `GET /api/v1/inventory/ingredients/{id}/movements`: `qty_after` is a running balance, and each movement carries `entered_qty`, `entered_unit`, `value_cents`, and a `reference` to its PO receipt, order or refund;
  - `PUT /api/v1/inventory/ingredients/{id}/reorder-level` (`{qty, unit}` or `null`);
  - `POST /api/v1/admin/ingredients/{id}/stock-adjustments`: the same `type`s and rules as products (`adjustment`, `count`, `wastage`; `receipt` is **not** allowed here, because stock in comes from receiving), with `{qty, unit}` and idempotent by `ulid`.
- **The inventory report** (`GET /reports/inventory`) gains `kind` (`in:products,ingredients`, default `products`).
  - Ingredient rows: `opening_qty`, `received`, `used` (sale), `returned` (void), `wasted`, `adjusted`, `closing_qty` (base units, strings), plus `value_cents` in and out.
  - The invariant holds as for products.
  - The CSV gains the same kind.
- **Insights:** `ingredients_out` (critical) and `ingredients_low` (warning), with the action `inventory.ingredients.alerts`.

#### D1. Set cost (revision 1.18, approved 2026-09-29)
A manual cost for an ingredient in the caller's branch. It is used before the first receipt (so recipes can be costed) and to correct a wrong average. Receipts keep re-weighting it afterwards (§B).
- **`POST /api/v1/admin/ingredients/{id}/cost`**
  - Permission **`inventory.adjust`**. The ingredient must be non-deleted.
  - Idempotent by `ulid`, as stock adjustments are.
  - **Body:**
    - `ulid` (required);
    - `cost_cents`: an integer, `min:1`, `max:100000000`. It is the price of **one** `unit`;
    - `unit`: any unit valid for the ingredient (§A), e.g. `₱1,200 per sack` or `₱0.48 per g`;
    - `reason`: optional, max 255.
- **Math (exact, server-side):**
  - `new_avg = round_half_up(cost_cents / factor(unit), 6)`, in centavos per base unit.
  - If `new_avg` rounds to 0: `422 cost_cents "The cost is too small for this unit."`.
- **Effects** (one transaction; the level is locked `FOR UPDATE` and created if missing):
  1. The level's `avg_cost` becomes `new_avg`.
  2. One **`revaluation`** movement is written (a new type):
     - `qty_delta "0.000"`, `qty_after` unchanged;
     - `value_cents = round_half_up(max(qty,0) × new_avg, 0) − round_half_up(max(qty,0) × old_avg, 0)`, so Σ `value_cents` keeps reconciling;
     - `unit_cost_cents = cost_cents`, `entered_qty "1.000"`, `entered_unit = unit`, `reason`.
  3. It is audited as `ingredient.cost_set` with `{avg_cost: {from, to}, cost_cents, unit}`.
  4. If `new_avg` equals the old one, nothing is written, and the call still returns 200.
- **Response:** `200 { "data": Ingredient }`, with the updated `avg_cost` and `stock_value_cents`.
- **Worked example:** Flour has `5000.000` g at `avg 4.000000` (value 20000). Set **₱1,250 per sack** (25000 g): `new_avg = 125000 / 25000 = 5.000000`, and the movement's `value_cents = 25000 − 20000 = +5000`. The value becomes ₱250.00.
- **History:** the entry is labelled `Cost set · ₱1,250.00 / sack`. The `type=revaluation` filter is added.
- **The inventory report** adds the `revaluation` value to `adjusted` value_cents; quantities are unaffected.
- **App:**
  - A **Set cost** action on the ingredient's inventory detail and on the ingredient edit screen (with `inventory.adjust`).
  - The dialog asks for the amount in pesos (converted to centavos), a unit picker (valid units only, default the base unit), and an optional reason.
  - It shows the resulting cost per base unit as a live preview before saving.
  - Recipe costs refresh after a save.

### E. Purchasing permissions (new slugs; the permissions seeder must be re-run)
| Slug | Meaning | Owner | Manager | Cashier |
|---|---|---|---|---|
| `purchase.request` | Create or edit PRs | ✓ | ✓ | – (grantable) |
| `purchase.approve` | Decide PR items; approve or decline POs | ✓ | **–** (Owner only since v1.20.2) | – |
| `purchase.approve_own` | Decide or approve a PR or PO you created | ✓ | – | – |
| `purchase.receive` | Record receipts | ✓ | ✓ | – |
| `supplier.manage` | Manage suppliers | ✓ | ✓ | – |

- **Only the Owner approves** (user decision, 2026-09-30): `purchase.approve` and `purchase.approve_own` are both owner-only, so a Manager can request and receive but gets `403` on every PR decision and PO approve or decline, and sees no approval insights. The Owner may decide their own PRs and POs.
- Deciding your own PR, or approving your own PO, without `purchase.approve_own` returns `403 { "message": "Someone else must approve your own request." }`.
- Reads (the PR, PO and receiving lists and details, and the report) need any purchase permission, or `report.view`.

### F. Purchase requests
**`PurchaseRequest`**
- `{ ulid, pr_no, status, requested_by{id,name}, date_needed, remarks, created_at, items[], purchase_order{ulid, po_no, status}|null }`.
- `pr_no` = `PR-{branch.code}-{YYYY}-{5-digit sequence}`, per branch and year, from the row-locked `sequences` table.
- **`status`** (derived from the items and stored):
  - `pending_approval` (any item pending);
  - `approved` (every item approved);
  - `partially_approved` (some approved, some declined);
  - `declined` (every item declined).

**Item:**
- `id`;
- `item: {type: "ingredient"|"product", id, name}`;
- `supplier{id,name}` (**required**);
- `qty`, `unit`, `base_qty`;
- `estimated_unit_price_cents` (nullable; per entered unit);
- `remarks`;
- `decision` (`pending|approved|declined`), `decision_reason`, `decided_by{id,name}`, `decided_at`.

A `product` item must have `stock_mode = own` (Round B; until then, `track_stock = true`).

**Endpoints** (base `/api/v1/purchase-requests`)
- **`GET`:** cursor list, newest first. Filters `status`, `supplier_id`, `search` (pr_no or item name), `mine` (boolean), `needs_decision` (boolean).
- **`POST`** (`purchase.request`): `{ulid, date_needed?, remarks?, items: [{item_type, item_id, supplier_id, qty, unit, estimated_unit_price_cents?, remarks?}] (1..100)}`.
  - Idempotent by `ulid` (`Idempotency-Key` = `ulid`).
  - An inactive supplier or ingredient returns `422`.
  - Returns 201.
- **`GET /{ulid}`:** returns the PR, plus `timeline[]` (audit entries: `{at, action, by{id,name}, details}`).
- **`PATCH /{ulid}`** (the requester or `purchase.approve`): only while **no item has been decided**; otherwise `409 "This request is already being reviewed."`.
  - The items are updated **by `id`**: new items have no `id`, and missing ids are removed. There is no delete-and-recreate.
- **`DELETE /{ulid}`:** the same condition. Soft cancel: `status = cancelled`, audited. It is never hard-deleted.
- **`POST /{ulid}/decisions`** (`purchase.approve` + the self-approval rule): `{ decisions: [{item_id, decision: approved|declined, reason?}] }`.
  - A `reason` (max 255) is **required** for `declined`: `422 on decisions.{i}.reason: Give a reason for declining.`
  - An item that is already decided returns `409 "This item was already decided."`
  - **When the last pending item is decided:**
    - the status is set;
    - when any item is approved, **one PO is created in the same transaction**. It has the approved items as lines, each keeping its supplier, qty and unit. `unit_price_cents` = the estimate, else the item's last approved PO price for that unit, else 0.
    - Audits `pr.item_approved` / `pr.item_declined` (with the reason), plus `po.created`.
  - Returns 200 with the PR.

### G. Purchase orders
**`PurchaseOrder`**
- `{ ulid, po_no, status, receiving_status, purchase_request{ulid, pr_no}, created_by, approved_by, approved_at, decline_reason, expected_delivery_date, remarks, total_cents, lines[], receipts[], timeline[] }`.
- `po_no` = `PO-{branch.code}-{YYYY}-{00001}`.
- **`status`:** `pending_approval` → `approved` (**Approved · Ready for Receiving**) | `declined`.
- **Line:**
  - `id`, `item{type,id,name}`, `supplier{id,name}`;
  - `qty`, `unit`, `base_qty`;
  - `unit_price_cents`, `line_total_cents = round_half_up(unit_price_cents × qty, 0)`;
  - `received_base_qty`, `received_qty` (in the line's unit, 3 decimals);
  - `remaining_qty = max(qty − received_qty, 0)`;
  - **`receiving_status`**: `pending` (0) | `partial` (< ordered) | `complete` (=) | `over_received` (> ordered).
- **PO `receiving_status`:**
  - `not_received`: nothing received;
  - `fully_received`: every line `complete` or `over_received`;
  - `partially_received`: otherwise.
- **`total_cents`** = Σ `line_total_cents`.

**Endpoints** (base `/api/v1/purchase-orders`)
- **`GET`:** cursor list. Filters `status`, `receiving_status`, `supplier_id`, `search`, `to_receive` (boolean: approved and not fully received).
- **`GET /{ulid}`.**
- **`PATCH /{ulid}`** (`purchase.request` or `purchase.approve`): `pending_approval` only. Lines are edited by `id` (qty, unit, unit price, supplier), plus `expected_delivery_date` and `remarks`. Lines can't be added. Otherwise `409 "An approved order can't be edited."`.
- **`POST /{ulid}/approve`** (`purchase.approve` + self-approval, applied to `created_by`, the PR approver who created it):
  - `422 "Set a price for every line before approving."` when any line has `unit_price_cents = 0`;
  - `409` if not pending.
  - Audit `po.approved` (`self_approved` when it applies).
- **`POST /{ulid}/decline`**: `{ reason }` (required, max 255). Audit `po.declined`.

### H. Receiving
**`POST /api/v1/purchase-orders/{ulid}/receipts`** (`purchase.receive`)
- **Body:** `{ ulid, remarks?, lines: [{po_line_id, qty, unit, reason?}] (1..100) }`. Idempotent by `ulid`.
- The PO must be `approved`: `409 "Approve the order before receiving."`
- **`qty`:** `> 0` normally. A **negative** qty is a correction and **needs** `reason`. A line's received total can't go below 0: `422 "Only <n> <unit> was received."`
- **Over-receiving is allowed.** The line becomes `over_received`.
- **Per line**, in one transaction:
  - convert to base;
  - `cost_cents = round_half_up(unit_price_cents × base_qty / line_unit_base_factor, 0)`, where `line_unit_base_factor` is the base qty of 1 unit of the PO line's unit;
  - write a **`receipt`** movement (a correction writes a negative one at the same cost basis) for the ingredient (value and `avg_cost` per §B) or the `own` product (qty, plus `unit_cost_cents` per base unit);
  - add to the line's `received_base_qty`;
  - recompute both statuses.
- **Records:** `goods_receipts` (`ulid, po_id, received_by, received_at, remarks`) and `goods_receipt_lines` (`po_line_id, qty, unit, base_qty, cost_cents, reason`). **They are append-only.** The PO's `receipts[]` lists them, newest first: the receiving history.
- **Audit** `po.received` (the receipt `ulid`, and per line the qty and unit).
- **Returns** 201 with the PO.

*Worked example I:*
1. PO line Flour 2 `sack` @ 120000 → `line_total 240000`.
2. Receive 1 `sack`: `base 25000.000`, cost 120000, line `partial`, PO `partially_received`.
3. Receive `1.2 sack`: `base 30000.000`, cost `round(120000 × 30000 / 25000) = 144000`. Received `2.200` > 2, so the line is **`over_received`** and the PO is **`fully_received`**.
4. A correction of `−0.2 sack` (reason "Counted wrong") brings the line to `complete`.

### I. Purchasing report
**`GET /api/v1/reports/purchasing`** (`report.view` or `purchase.approve`) and **`/export`** (CSV, following the Phase 6 conventions).
- **Query:**
  - `from`, `to` (PR created date, business days, max 366);
  - `status` (the PR status);
  - `decision`;
  - `po_status`;
  - `receiving_status`;
  - `supplier_id`;
  - `item_type` + `item_id`.
- **Row per PR item:**
  - `pr_no`, `pr_date`, `requested_by`;
  - `item_name`, `supplier_name`;
  - `requested_qty`, `unit`;
  - `decision`, `decision_reason`, `decided_by`;
  - `po_no`, `po_status`;
  - `ordered_qty`, `received_qty`, `remaining_qty`;
  - `line_receiving_status`;
  - `unit_price_cents`, `ordered_cents`, `received_cents`;
  - `last_received_at`.
- **Totals:**
  - `prs`, `items`, `approved`, `declined`, `pending`;
  - `pos` by status;
  - `ordered_cents`, `received_cents`, `remaining_cents`.
- **Size:** max 500 rows with `meta.truncated`. Set-based SQL, **under 500 ms** on a year of data.

**Insights**
- `purchase_requests_pending` (warning; `purchase.approve`);
- `purchase_orders_pending` (warning; `purchase.approve`);
- `purchase_orders_to_receive` (info; `purchase.receive`).

`pr.*` and `po.*` audit entries stay out of the dashboard activity feed.

### J. Recipes and depletion (Round B)
**Product stock modes**
- `products.stock_mode`: `own` | `recipe` | `none`.
- **Migration:** `track_stock = true` → `own`; everything else → `none`.
- `track_stock` stays in responses as `stock_mode == own`, so existing clients keep working.
- **Admin product changes:**
  - `stock_mode` is editable.
  - `own` → anything else needs the product's stock ≤ 0: `409 "Use up or write off the stock first."`
  - `recipe` → anything else keeps the recipe rows but ignores them.

**Recipe**
- Only for `stock_mode = recipe`.
- `GET/PUT /api/v1/admin/products/{id}/recipe` (`product.manage`).
- **Request body:** `{ lines: [{component_type: ingredient|product, component_id, qty, unit}] (0..50) }`.
- **Components:** an ingredient, **or** a product with `stock_mode = own`. No recipe products (no nesting). No duplicates.
- **Stored:** the entered `qty`/`unit` + `base_qty` **per 1 serving**.
- **Response `Recipe`:**
  - `lines[{component{type,id,name,base_unit}, qty, unit, base_qty, unit_cost, line_cost_cents}]`;
  - `cost_cents = Σ line_cost_cents`, where `line_cost_cents = round_half_up(base_qty × avg_cost, 0)` for ingredients and `cost_cents` × qty for `own` products;
  - `price_cents`, `margin_bps`.
- **`POST /api/v1/admin/products/{id}/recipe/apply-cost`** sets the product's `cost_cents` to the recipe cost (audited).
- **Audit:** `recipe.updated`.

*Worked example J (per serving):*
- Pancake = Flour 1 `cup` (120.000 g @ 4.666667 → **560**) + Egg 1 `pc` (@ 800.000000 → **800**) + Milk 0.5 `cup` (118.294 mL @ 9.500000 → **1124**).
- `cost_cents` = **2484** (₱24.84).

**Depletion when a sale is confirmed** (inside the sale transaction; `CompleteSaleAction` online, and offline ingest at sync using the **current** recipe)
1. For every line whose product is `recipe`, each component's `base_qty × line.qty` is summed **per component** across the order.
2. **One `sale` movement per component** (an ingredient: `value_cents` at `avg_cost`; an `own` product: `unit_cost_cents` snapshot). It **never blocks**, even when stock goes negative.
3. A snapshot in **`order_item_components`** per order line: `order_item_id`, the component, `base_qty` (per line), and `cost_cents`.
4. **Void:** each component's snapshot qty returns through a `void` movement at the snapshot cost. An ingredient's `avg_cost` is re-weighted as for a receipt (Q-032).
5. **Refund** of `k` of `n` units:
   - **Stock is not returned**, because the food was already made, and **no stock movement is written** (the sale already deducted it).
   - The refunded share of each component, `round_half_up(base_qty × (p + k) / n, 3) − round_half_up(base_qty × p / n, 3)` (cumulative, as the refund formula), is added to that snapshot's **`wasted_base_qty`**, linked to the refund.
   - The ingredient inventory report and the ingredient history show it as **wasted** ("Refund INV-…: <reason>") instead of used. So the loss is visible, and nothing is deducted twice.
6. Online sales of `own` products still check stock as in Phase 3. **Recipe components are never checked.**

**Sell badges**
- `GET /sync/stock` gains `recipes: [{product_id, status: "ok" | "check"}]`: `check` when any component is `out`.
- The app shows a warning chip `Check stock` on those tiles. They stay tappable.

**Reports:** the ingredient inventory report's `used` covers recipe depletion.

### K. Data model (backend)
- **`units`:** seeded.
- **`ingredients`:** soft deletes, `base_unit`, `image_path`, `is_active`.
- **`ingredient_units`.**
- **`suppliers`:** soft deletes.
- **Stock tables:**
  - `stock_levels`: `ingredient_id`, `product_id` nullable, `reorder_level` → `DECIMAL(15,3)`, `avg_cost DECIMAL(20,6)`;
  - `stock_movements`: `ingredient_id`, `entered_qty`, `entered_unit`, `value_cents`;
  - the CHECKs;
  - the `type` enum is unchanged (`receipt` already exists).
- **Purchasing:**
  - `purchase_requests` (`ulid`, `pr_no` UNIQUE, `branch_id`, `requested_by`, `status`, …) + `purchase_request_items`;
  - `purchase_orders` + `purchase_order_lines`;
  - `goods_receipts` + `goods_receipt_lines`.
- **Round B:**
  - `products.stock_mode`;
  - `recipe_lines` (`product_id`, component columns, `qty`, `unit`, `base_qty`);
  - `order_item_components`.
- **Foreign keys:** every FK touching financial or stock records is RESTRICT. Quantities are `DECIMAL(15,3)`. Money is integer centavos.
- **Numbering:** from `sequences` (the names `purchase_request` and `purchase_order`, period = the year).

### L. Device rules (frontend)
**Navigation**
- **Catalogue:** Menu, **Ingredients**, Inventory (a `Products | Ingredients` switch).
- **A new Purchasing group:** Purchase requests, Purchase orders, Receiving, Suppliers.
- **Reports:** `Sales | Inventory | Purchasing`.

**Units in the app**
- **A unit picker** (the valid units only) grouped as *This ingredient's units* and then the catalog units of its dimension, with a live base preview (`= 50,000 g`). The math uses `BigInt` for previews, and the server's `base_qty` is shown after saving.
- **The ingredient form's units editor:** the name, then `1 <name> = [factor] <base unit>`, with inline validation for the reserved codes.

**Screens**
- **Ingredients:** list, create/edit (image, base unit locked once in use, units editor).
- **Ingredient inventory:** list, detail, history (with the entered qty and unit shown), and adjust dialogs with a unit picker.
- **Suppliers:** list, create/edit.
- **Purchase requests:**
  - **List:** status chips, "Needs my decision", "Mine".
  - **Create/edit:** item picker (**active ingredients only**, per the user on 2026-09-30; the API still accepts `own` products, and existing product items still display), supplier picker, qty + unit, estimated price, remarks.
  - **Detail:** items with **Approve** / **Decline** per item (decline asks for a reason), **Approve all remaining**, the decision chips, the timeline, and a link to the PO.
- **Purchase orders:**
  - **List:** status and receiving chips.
  - **Detail:** lines with their suppliers, prices, totals and edits while pending; **Approve** / **Decline** (reason); the timeline; the receipts history.
- **Receiving:**
  - **List:** POs to receive.
  - **Receive screen:** per line the ordered, received and remaining quantities, a qty + unit entry, and a live status chip (Pending, Partial, Complete, **Over-received** in warning); **Correction** (negative, reason); remarks. The ULID is kept until a 201, and Retry uses the same body.
- **Recipe (Round B):** a section on the product edit screen when `stock_mode = recipe`. It has a component picker (**active ingredients only**, per the user on 2026-09-30; the API still accepts `own` products, and saved product components still display and save), qty + unit, the per-line cost, and the **cost per serving and margin**, plus **Use as product cost**. The product form gets a stock mode selector (`Own stock` / `Recipe` / `Not tracked`).
- **Purchasing report:** filters, a totals card, the rows table (wide and phone layouts), CSV export.

**Status labels:**
- PR: `Pending Approval`, `Approved`, `Partially Approved`, `Declined`, `Cancelled`.
- PO: `Pending Approval`, `Approved · Ready for Receiving`, `Declined`.
- PO receiving: `Not Received`, `Partially Received`, `Fully Received`.
- Line: `Pending`, `Partial`, `Complete`, `Over-received`.

---

## Feature: Hardening & Pilot (Phase 8) — APPROVED (v1.23)
Status: **APPROVED** (2026-10-12, revised for the Web POS).

**Goal:** run a full real service day with no data loss.

**Choices made (2026-09-30):**
- **Errors:** a built-in error log. There is no third-party service, no new app package and no new dev build.
- **Backups:** removed from this phase at the user's request.
- **Release:** one `production` EAS profile: an APK, internal distribution, channel `production`.
- **Devices:** setup and health screen, device management, and release builds with a version check.
- **Training:** written guides only.

**Choices added (2026-10-12, after the Web POS):**
- **Web terminals get full parity.** That means error capture, a heartbeat and a "This terminal" health page (§I). `W` devices appear in admin Devices and can be retired and restored.
- **Version gating stays tablet-only.** The server always serves the current web build.
- **The admin Devices and Error log screens are built on both the tablet and the web.**
- **Shared rules go in `@pos/core/errors`** (`packages/pos-core/src/errors/`), owned by **frontend-agent**:
  - redaction;
  - message normalisation and the local fingerprint;
  - the semver compare;
  - the device `health` labels.

  web-agent imports them once they land, and builds the admin screens first.

### A. Permission (the permissions seeder must be re-run)
- New slug **`system.manage`**: "Manage tablets and the error log".
- Owner and Manager get it; it isn't owner-only. Cashiers don't have it.

### B. Error log

#### POST /api/v1/client-errors
| | |
|---|---|
| Route name | `v1.client-errors.store` |
| Auth | **optional**: a crash can happen before login. When a valid token is sent, the user and device are recorded. |
| Throttle | 30 requests / minute per IP, and 20 errors per request |

- **Body:** `{ "errors": [ClientError] }` (1..20).
- **Each `ClientError`:**
  - `ulid` (required, the idempotency key, so a duplicate is ignored);
  - `occurred_at` (ISO 8601);
  - `level` (`in:warning,error,fatal`);
  - `message` (required, max 1000);
  - `stack` (nullable, max 16000);
  - `context` (object, all fields optional): `screen` (max 120), `app_version` (max 20), `os` (max 20), `os_version` (max 20), `device_model` (max 60), `install_id` (ULID), `online` (bool), `extra` (object, at most 20 string keys and values of 500 characters).
- **Server:**
  - Truncates rather than rejects over-long strings. Only a malformed body gets a 422.
  - Computes `fingerprint = sha1(source + level + normalised message + top stack frame)`, where the normalised message has digits and ULIDs replaced by `#`.
  - Upserts the **group** by fingerprint and inserts the occurrence.
  - **Never stores** request bodies, tokens, PINs or passwords. The app redacts before sending (§F).
- **202:** `{ "data": { "accepted": 3, "duplicates": 1 } }`.
- **Errors:** `422`, and `429` (the app keeps the errors and retries later).

**Server-side errors are recorded in the same log.** Every unhandled exception that yields a 5xx is recorded with `source: "server"`, `level: "error"`:
- the exception class, message and top frames (max 16000);
- the route name and method, the user id and the device id.

It never records request input, headers or the query string. Recording fails silently and never changes the response.

**Tables:**
- `error_groups`: `fingerprint` UNIQUE, `source` (`app|server`), `level`, `message`, `first_seen_at`, `last_seen_at`, `occurrences`, `status` (`open|resolved`), `resolved_at`, `resolved_by`, `app_versions` (JSON, the last 5 distinct).
- `error_events`: `ulid` UNIQUE, `error_group_id`, `branch_id` (nullable), `user_id`, `device_id`, `occurred_at`, `received_at`, `message`, `stack`, `context` (JSON).
- **A resolved group reopens automatically** when a new occurrence arrives.
- **Retention:** events older than 90 days are pruned daily, and groups with no events left are deleted.

#### GET /api/v1/admin/error-log
- Permission `system.manage`. Cursor list of groups, ordered by `last_seen_at` desc.
- **Filters:** `status` (default `open`), `source`, `level`, `search` (message), `from`/`to` (on `last_seen_at`).
- **Item:** `{ id, source, level, message, status, occurrences, first_seen_at, last_seen_at, app_versions, resolved_at, resolved_by{id,name}|null, latest{occurred_at, screen, app_version, device{id,code,name}|null, user{id,name}|null} }`.
- **`meta.summary`:** `{ open, open_fatal, last_24h }`.

**Other endpoints:**
- **`GET /api/v1/admin/error-log/{group}`:** the group plus `events`, the latest 50 (each with `stack` and `context`).
- **`POST /api/v1/admin/error-log/{group}/resolve`** → 200 group. **`…/reopen`** → 200 group. Both are audited: `error.resolved` / `error.reopened`.

**Visibility:**
- Server groups and groups with no branch are visible to every `system.manage` holder.
- App events are scoped to the caller's branch, unless the caller has `branch.all`.

### C. Devices

**`devices` gains:**
- `retired_at` (nullable);
- `last_heartbeat` (JSON), `last_heartbeat_at`;
- `last_user_id`.

**`is_active = false`** means retired.

**Registering an existing device** (Q-044): it keeps its current `name`, so an admin rename lasts. The `name` sent is only used when the device is created.

**Registering a retired tablet:** `POST /devices/register` with a retired tablet's `install_id` → `403 "This tablet has been retired. Ask a manager to restore it."`.

**A token bound to a retired device** → `401 { "message": "This tablet has been retired." }` on every request. The app signs out, as for any 401. **This is the only case where a sale can't be sent.** Retiring checks for unsynced sales first (below).

#### POST /api/v1/devices/heartbeat
Any authenticated user; the token must be bound to a device, otherwise `409 "Register this tablet first."`.

**Body** (all fields optional unless marked):
- `app_version` (required);
- `os_version`, `device_model`;
- `outbox_pending`, `outbox_failed` (int);
- `oldest_pending_at`;
- `errors_pending` (int);
- `last_catalogue_sync_at`, `last_stock_sync_at`;
- `storage_free_mb` (int);
- `printers: [{id, ok, checked_at}]` (max 20).

**Effects:** updates `last_seen_at`, `last_heartbeat(_at)`, `app_version` and `last_user_id`. Writes no audit entry.

**200:** `{ "data": { "server_time": "…", "app": AppVersionInfo } }`.

#### GET /api/v1/app-version
No auth, throttled at 60/min.

**200:** `{ "data": AppVersionInfo }`, where `AppVersionInfo = { min_version, latest_version, update_url|null }`, taken from `APP_MIN_VERSION`, `APP_LATEST_VERSION` and `APP_UPDATE_URL` (defaults `1.0.0`, `1.0.0`, null).

Versions are compared as semver `major.minor.patch`.

#### Admin devices (permission `system.manage`, branch-scoped)
- **`GET /api/v1/admin/devices`:**
  - Cursor list, ordered active first, then by `code`.
  - Filters: `status` (`active|retired|all`, default `active`), `platform` (`android|web`) and `search`.
  - **Item:** `{ id, code, name, platform, app_version, last_seen_at, is_active, retired_at, last_user{id,name}|null, heartbeat{outbox_pending, outbox_failed, oldest_pending_at, errors_pending, last_catalogue_sync_at, last_stock_sync_at, storage_free_mb, os_version, device_model, printers}|null, heartbeat_at, health }`.
  - **`health`** is derived:
    - `offline`: last seen over 30 min ago;
    - `attention`: `outbox_failed > 0`, or pending sales older than 30 min, or an app older than `min_version`, or storage under 500 MB;
    - otherwise `ok`. Retired devices get `retired`.
    - **Web terminals** (`platform: web`) have no outbox and no version gating. Only the last-seen rule and `errors_pending > 0` (`attention`) apply to them.
- **`GET /api/v1/admin/devices/{id}`** (Q-043): 200 `{ data: AdminDevice }`.
  - Includes retired devices.
  - 404 for a device in another branch (unless `branch.all`) or one that doesn't exist.
- **`PATCH /api/v1/admin/devices/{id}`:** `{name}` (max 60). Audited `device.renamed`.
- **`POST /api/v1/admin/devices/{id}/retire`:** `{confirm?: bool}`.
  - If the last heartbeat reported `outbox_pending > 0` and `confirm` isn't true: `409 { "message": "T02 still has 5 unsynced sales. Sync it first, or retire it anyway.", "outbox_pending": 5 }`.
  - Otherwise it sets `is_active=false` and `retired_at`, **deletes the tokens bound to it**, and audits `device.retired`.
  - A web terminal never gets the 409, because it sells online only.
- **`POST /api/v1/admin/devices/{id}/restore`:** reactivates the device (staff log in again). Audited `device.restored`.

**Insight:** `device_unsynced` (warning), "T02 has 5 unsynced sales (last seen 2 h ago)", for an active device with `outbox_pending > 0` whose heartbeat is over 30 min old.
- Its `action` is `settings.devices`, and it appears only when the caller has `system.manage`.

### D. Release builds (mobile)

**`eas.json`** keeps `development` and adds **one** release profile, **`production`**:
- `"distribution": "internal"`, `"channel": "production"`, `"android": { "buildType": "apk" }`;
- `autoIncrement` versionCode, with `cli.appVersionSource: "remote"`;
- `EXPO_PUBLIC_API_URL` from the EAS environment.

**EAS project:** `@cypherlee/mobile-pos`, ID `72d10ccd-c1a8-4463-a8f4-fbcf95964749`. It was linked on 2026-09-30, and `app.json` now has `slug: "mobile-pos"`, `owner` and `extra.eas.projectId`.

The APK is installed on the pilot tablets directly from the EAS internal-distribution link. The `channel` only takes effect if OTA updates are added later. No `preview` profile.

**Play Store AAB and OTA updates** (`expo-updates`) are out of scope; each needs a new package or account.

**App version:** `expo.version` in `app.json` is the semver sent as `app_version`, read with `expo-constants`.

**Version check (tablet only):** on launch, on foreground (at most every 15 min) and in every heartbeat response:
- **Below `min_version`:**
  - A blocking **Update required** screen with the update link. The **outbox and the error queue keep syncing**, and the screen shows `N sales still to send`.
  - Nothing is blocked server-side: sales from any version are always accepted.
- **Below `latest_version`:** a dismissible **Update available** banner, shown once per version.

### E. Setup & health screen (mobile)

**Route `/(app)/device`**, "This tablet", in the sidebar under Settings. Every signed-in user sees it. Actions marked * need `system.manage` or `settings.manage`.

**Checklist** at the top, each item ✓ / ⚠ / ✗ with a fix hint:
1. Server reachable;
2. Tablet registered;
3. Clock in sync (|drift| ≤ 2 min against `server_time`);
4. Menu synced within 24 h;
5. At least one receipt printer configured and its last test OK;
6. No failed sales in the outbox;
7. App up to date.

**Sections:**
- **Server:** URL, reachability and latency, server time and drift. *Check now*.
- **This tablet:** code, name, the last 6 characters of the install ID, app version, OS and model, free storage.
- **Sync:**
  - outbox pending and failed, with the oldest pending age;
  - last menu, stock and order sync;
  - *Sync now*;
  - *View failed sales*, a read-only list with each error.
- **Printers:** each configured printer with its last status. *Test print** per printer.
- **Error reports:** the number waiting to send. *Send now*.
- **Send diagnostics:** sends a heartbeat and flushes the error queue immediately, then shows "Sent at hh:mm".

**Heartbeat:**
- Sent every 5 min while online and signed in, and on foreground (throttled to 1/min).
- Never blocks the UI. Failures are silent.

**Admin screens (tablet and web, the same behaviour on both):**
- **Devices** (Settings, `system.manage`):
  - a platform filter (Tablets / Web terminals);
  - list cards with a health chip and the unsynced count;
  - a detail with the heartbeat fields;
  - rename, retire (with the 409 confirm dialog) and restore.
- **Error log** (Settings, `system.manage`):
  - groups with filters and the summary;
  - a detail with its events, stack in a monospace scroll and context;
  - resolve / reopen.

### F. App error capture (mobile)

**What is captured:**
- A **global JS handler** (`ErrorUtils.setGlobalHandler`), marked `fatal` when the runtime says so; it then calls the previous handler.
- **Unhandled promise rejections.**
- A **root React error boundary** that shows a friendly "Something went wrong" screen with **Restart app**. The error is kept and sent later.
- **Caught errors worth knowing:** a print failure after all retries, a sale rejected by `/sync/orders`, an unexpected 5xx from any service call (`level: error`), and any failed migration of the local SQLite database.

**Redaction:**
- Authorization headers and tokens, PINs and passwords are never included, nor are any request or response bodies.
- URLs lose their query string.
- Customer names, phone numbers and SC/PWD ID numbers are never included.

**Queue:**
- A SQLite table `error_queue` holds up to 200 entries; the oldest are dropped first.
- The queue is flushed by the sync worker when online, in batches of 20.
- A 429 or network error keeps the entries.

**Duplicates:** the same fingerprint (message + top frame) within 60 s is counted once locally.

**Limitation:** crashes in native code (Java/Kotlin) aren't captured without a native crash SDK. Only JavaScript errors are.

### G. Soak and load tests
**Backend: `--group=soak`**, excluded from the default run like `performance`. One test simulates a **service day** on a seeded catalogue:
- **Setup:** 3 tablets, each with its own shift (opened, cash in/out, closed with a count).
- **Traffic:**
  - 600 orders: 70% online, 30% offline in batches of 25, with **every batch replayed once**, some orders sent both online and offline, and mid-batch retries;
  - recipe and `own` products, discounts, SC/PWD, split payments;
  - 10 voids and 15 full or partial refunds;
  - one PO receipt;
  - one `Set cost` during service.

**Afterwards it asserts:**
- zero duplicate orders or payments;
- every ULID accounted for;
- Σ payments − Σ refund payments = the sales report's net;
- each shift's Z-read equals its orders;
- the stock ledger (Σ `qty_delta` = level) and the ingredient value invariant hold;
- the inventory and purchasing reports reconcile.

**Timing:** p95 of `POST /orders` under 300 ms, and a 25-order `/sync/orders` batch under 2 s, on the real MySQL.

**Mobile, a jest soak for the outbox:**
- 500 queued sales against a mock server that flaps (timeouts, 5xx, 429, and an airplane toggle);
- every sale is delivered **exactly once** (`accepted` or `duplicate`), and nothing is lost across a simulated app restart.

### H. Guides (written by the main session after the build)
- **In `docs/guides/`, one per role:** `cashier.md` (sale, discounts, SC/PWD, offline, shifts, reprint), `manager.md` (voids and refunds, review queue, stock, purchasing, reports, devices) and `owner.md` (staff, settings, devices, error log, approvals).
- **`pilot-runbook.md`:**
  - **Server:** server setup, including the scheduler task on Windows (`schedule:run` every minute, for error-log pruning and token pruning).
  - **Tablets:** tablet install (the `production` APK) and first login, printer setup and test.
  - **Web terminals:**
    - the web build (`npm run build`, served at `/pos`);
    - running the print agent (`print-agent:run`) as a Windows scheduled task that restarts it;
    - first login on a counter PC, and choosing its receipt printer.
  - **Service day:** the opening-day checklist, the offline procedure, end of day (Z-read), and "what to do if…".

### I. Web terminals (added v1.23)

**Version:** `web/package.json` `version` (set to `1.0.0` for the pilot). Vite injects it at build time as `__APP_VERSION__`, and it is sent as `app_version`.

**Error capture:**
- `window.onerror` and `unhandledrejection`.
- A root React error boundary showing "Something went wrong" with **Reload**.
- The same "caught errors worth knowing" as the tablet:
  - a print job that ends `failed`;
  - an unexpected 5xx from any service call.
- **Redaction and the 60 s local de-duplication** come from `@pos/core/errors`, so they match the tablet.
- **The queue** lives in `localStorage` key `pos.errorQueue`:
  - at most 200 entries, the oldest dropped first;
  - flushed in batches of 20 every 60 s, on the browser's `online` event, and after login;
  - a 429 or network error keeps the entries;
  - a `localStorage` failure loses the entries silently and never breaks the page.
- **Context:**
  - `os: "web"`;
  - `os_version`: the browser name and major version;
  - `device_model`: null;
  - `install_id`: the terminal's install id.

**Heartbeat:**
- The same `POST /devices/heartbeat`, every 5 min while signed in and the tab is visible, and on `visibilitychange` (at most 1/min).
- It sends:
  - `app_version`;
  - `os_version`;
  - `errors_pending`;
  - `printers`: the terminal's receipt printer plus the kitchen printers. Each one's `ok` is its latest print job's status (`printed` means ok, `failed` means not ok, none means omitted).
- No outbox fields. Failures are silent.

**"This terminal" page:** route `/device`, under Settings, for every signed-in user. It has the same layout as the tablet's §E, without the outbox and version items. *(Removed from the web on 2026-10-26 at the user's request: no menu item or route. The error capture, the error flush and the heartbeat still run in the background, and the receipt printer is still chosen on Printers and on Sell.)*
- **Checklist:**
  1. Server reachable;
  2. Terminal registered;
  3. Clock in sync;
  4. A receipt printer is chosen and its last job is OK;
  5. The print agent is running: none of this terminal's jobs has been `queued` for over 2 min (Q-042).
- The print-agent check uses the existing `GET /print-jobs`: `queued` jobs older than 2 min mean the agent is down.
- Actions: *Check now*, *Test print* (`kind: "test"`) and *Send diagnostics*.

**A retired web terminal:** the 401 "This tablet has been retired." signs the user out like any 401. The login page shows the message when registration then returns 403. The server wording stays "tablet" for both platforms.

### J. Build round (one round; the three agents run in parallel)
| Agent | Work |
|---|---|
| **backend-agent** | §A permission + seeder; §B tables, `POST /client-errors`, 5xx capture, admin error-log endpoints, daily prune; §C device columns, heartbeat, `GET /app-version`, retired 401/403, admin devices with `platform` + `health`, `device_unsynced` insight; §G backend soak (`--group=soak`); feature tests for each |
| **frontend-agent** | `@pos/core/errors` (first); §D `production` profile + version check; §E "This tablet" + admin Devices + Error log; §F capture + `error_queue`; heartbeat; jest outbox soak |
| **web-agent** | §E admin Devices + Error log (web); §I capture, queue, heartbeat, "This terminal" page; `__APP_VERSION__` |

The main session writes §H (guides) after the build.

### Not in this phase
- **Backups** (removed from Phase 8 by the user, 2026-09-30).
- Play Store release and OTA updates.
- A third-party crash SDK.
- Training mode.
- Multi-branch activation (v3).

---

## Feature: Web POS & Print Bridge
Status: **APPROVED** (2026-10-08)

**Goal:** a browser-based POS terminal and back-office (`web/`), on the same API and the same database as the tablet app. It replaces the legacy `C:\xampp\htdocs\pos` system, which is **not migrated**; it only donates UI pieces.

**Choices made (user, 2026-10-07):**
- **One system:** one Laravel API, one database (every table is `tbl_`-prefixed; changelog 1.20.4).
- **Scope:** cashier selling **and** the full back-office.
- **Online only:** the web terminal has no offline queue. A failed `POST /orders` keeps the cart and shows the error.
- **Printing:** a server-side print-job queue and a print agent on the restaurant LAN, for **web terminals only**. Tablets keep printing directly over TCP (PROJECT_MEMORY decision #8 is unchanged).

**Not in this phase:** offline web sales, browser print dialog receipts, a kitchen display screen, a PWA install, multi-branch print agents, and importing `db_pos` data.

### A. Hosting (same origin, so no CORS)
- `web/` is a standalone Vite app with its own `package.json`.
- **Dev:** the Vite dev server proxies `/api` and `/storage` to `VITE_API_PROXY_TARGET` (e.g. `http://127.0.0.1:8000`) and listens on `0.0.0.0`, so another PC on the LAN can open it.
- **Prod:** `npm run build` writes to `public/pos/`. `routes/web.php` adds `GET /pos/{path?}` (`where('path', '.*')`, route name `web-pos`), which returns `public/pos/index.html` (404 with a plain message when the build is missing). The app runs at `/pos` with React Router `basename="/pos"`.
- Because the browser always talks to its own origin, **`config/cors.php` is not added**. `public/pos/` is gitignored.

### B. Auth (unchanged endpoints)
- Login, `me`, logout and the PIN switch are exactly as in "Auth & Access Control". The web client sends `Authorization: Bearer <token>`; decision #9 (tokens, no session cookies) stands.
- The token is stored in `localStorage` under `pos.token`. To keep that safe the web app never uses `dangerouslySetInnerHTML` and `index.html` carries a CSP `<meta>` limited to `'self'`.
- 401 → clear the token and session, go to `/pos/login`. 403 → "You don't have permission to do that." Navigation is filtered by `me.permissions`, but the server stays the authority.

### C. Devices: web terminals
`POST /api/v1/devices/register` gains one optional field:

| Name | Rules | Notes |
|---|---|---|
| `platform` | `nullable`, `in:android,web` | Default `android` (existing tablets send nothing) |

- **Migration:** `devices.platform` `string(10)`, not null, default `'android'`.
- A **new** web device gets the code `W` + its id padded to 2 digits (`W03`); tablets keep `T`. An existing device's code and platform never change.
- The response `data` gains `platform`. Admin device items (Phase 8) also show it.
- The web client generates `install_id` (a ULID) once per browser profile, stores it in `localStorage` under `pos.install_id`, and registers after every login with `name` = `Web · <browser> on <OS>` (max 60). Each browser profile is therefore one terminal, with its own shift.
- Web terminals never send heartbeats and call no `/sync/*` endpoint except `GET /sync/stock` (read-only stock badges; Q-036).

### D. Print jobs (users; branch-scoped)
**Table `print_jobs`:**
- `id`; `ulid` char(26) UNIQUE (client-generated); `branch_id`; `device_id` (nullable FK); `printer_id` (FK `printers`, RESTRICT)
- `kind` enum `receipt, kitchen, x_read, z_read, void_slip, kitchen_void, refund_slip, test` (the tablet's kinds plus `test`)
- `order_ulid` char(26) nullable: the order's ULID, or the **refund's** ULID for `refund_slip` (as on the tablet)
- `copy_no` tinyint (1–3); `is_reprint` boolean
- `payload` MEDIUMBLOB: the raw ESC/POS bytes
- `status` enum `queued, printing, printed, failed`; `attempts` tinyint; `last_error` string(255) nullable
- `claimed_by` string(40) nullable; `claimed_at`, `printed_at` nullable; `created_by` (user); timestamps
- Index `(branch_id, status, id)`.

**`PrintJob` resource:** `{ ulid, printer_id, printer_name, kind, order_ulid, copy_no, is_reprint, status, attempts, last_error, created_at, printed_at }` (`printer_name` from the printer, including soft-deleted).

#### POST /api/v1/print-jobs
Route `v1.print-jobs.store`, `Api\V1\PrintJobController@store`. Any authenticated user. The token must be bound to a device, otherwise `409 "Register this terminal first."`.

| Field | Rules |
|---|---|
| `ulid` | `required`, ULID regex |
| `printer_id` | `required`, `integer`, a non-deleted printer in the caller's branch (`422 "The selected printer is invalid."`); a disabled printer → `422 "This printer is disabled."` |
| `kind` | `required`, `in:` the kinds above |
| `order_ulid` | ULID regex; `required` unless `kind` is `x_read`, `z_read` or `test` |
| `copy_no` | `integer`, `min:1`, `max:3`, default 1 |
| `is_reprint` | `boolean`, default `false` |
| `payload_base64` | `required`, `string`, valid base64; the decoded size must be 1–65,536 bytes (`422 "The print data is too large."`) |

- **Idempotent by `ulid`:** a replay returns `200` with the existing job.
- **First-print deduplication:** when `is_reprint` is false and `kind` isn't `x_read`, `z_read` or `test`, a job with the same `(order_ulid, kind, printer_id, copy_no)` in the branch returns `200` with that job instead of creating one (so a double-click never prints twice).
- New job: `201 {data: PrintJob}`, status `queued`. No audit entry.

#### GET /api/v1/print-jobs
Route `v1.print-jobs.index`. Query `ulids[]` (`required`, `array`, `max:50`, each a ULID). Returns `{ data: PrintJob[] }` for the jobs found in the caller's branch, in no particular order; unknown ulids are left out. Not paginated (bounded by 50).

#### POST /api/v1/print-jobs/{ulid}/retry
Route `v1.print-jobs.retry`. Only a `failed` job: back to `queued`, `attempts` reset to 0, `last_error` cleared → `200 {data: PrintJob}`. Any other status → `409 "Only a failed print can be retried."`. Another branch → `404`.

**Errors (all three):** `401` · `404` · `409` · `422`

### E. Print agent (machine endpoints)
- No Sanctum. Every request carries `X-Print-Agent-Token`, compared with `hash_equals` against `PRINT_AGENT_TOKEN`. Unset or empty env → `503 {"message": "The print agent is not configured."}`. Wrong token → `401 {"message": "Invalid print agent token."}`. Throttled at 120/min.
- The agent serves one branch: `PRINT_AGENT_BRANCH_ID` (default `1`). Multi-branch agents are v3.

| Method | URI | Route name | Success |
|---|---|---|---|
| GET | `/api/v1/print-agent/ping` | `v1.print-agent.ping` | `200 {data: {server_time}}` |
| POST | `/api/v1/print-agent/jobs/claim` | `v1.print-agent.claim` | `200 {data: AgentJob[]}` |
| POST | `/api/v1/print-agent/jobs/{ulid}/result` | `v1.print-agent.result` | `200 {data: {ulid, status}}` |

**Claim** body: `agent_id` (`required`, `string`, `max:40`), `limit` (`integer`, 1–20, default 10).
- In one transaction (`SELECT … FOR UPDATE SKIP LOCKED`), takes the oldest jobs of the branch that are `queued`, or `printing` with `claimed_at` older than **60 s** (a crashed agent). Sets `status = printing`, `claimed_by`, `claimed_at`, `attempts + 1`.
- A job whose printer is now disabled or deleted is set to `failed` with `last_error "The printer is disabled."` and not returned.
- `AgentJob` = `{ ulid, printer: { host, port }, payload_base64, attempts }`. Host and port are read **at claim time**, so editing a printer's IP takes effect on the next job.

**Result** body: `agent_id` (`required`), `status` (`required`, `in:printed,failed`), `error` (`nullable`, `string`, `max:255`), `retryable` (`boolean`, default `false`).
- `printed` → `printed_at` set.
- `failed` with `retryable` and `attempts < 3` → back to `queued`; otherwise `failed` with `last_error`.
- The job must be `printing` and claimed by this `agent_id`, otherwise `409 "This job is not claimed by this agent."`. Unknown ulid → `404`.

**Command `php artisan print-agent:run {--once}`**
- Reads `PRINT_AGENT_API_URL`, `PRINT_AGENT_TOKEN` and `PRINT_AGENT_ID` (default: the hostname). It talks to the API **over HTTP**, so it can run on any PC on the printers' LAN even when the server is in the cloud. In dev it runs on the Laragon PC.
- Loop: claim → group jobs by `host:port` → send each job's bytes with the tablet's transport rules (connect timeout **5 s**, write, flush, shut down output, drain input until EOF or 1.5 s, close) → report the result. Connect errors (timeout, refused, unreachable) are `retryable`. A dead printer skips the rest of its group in that round so the others aren't delayed. Sleep 1 s when nothing was claimed. `--once` runs one round (used by tests).
- The bytes are prebuilt by the client, so the agent needs **no ESC/POS library** and no new Composer package.

**Command `php artisan print-jobs:prune`:** deletes `printed` and `failed` jobs older than 30 days. Scheduled daily.

**`.env.example` gains:** `PRINT_AGENT_TOKEN=`, `PRINT_AGENT_BRANCH_ID=1`, `PRINT_AGENT_API_URL=`, `PRINT_AGENT_ID=`.

### F. Web client rules (frontend)
- **Stack:** Vite, React 19, TypeScript strict, Tailwind 4, shadcn/ui (Radix), TanStack Query, TanStack Table, React Router, Recharts, `ulid`. Colours and status colours come from the Sage Emerald tokens, as CSS variables in one theme file.
- **Structure (`web/src/`):** `routes/` (pages only), `components/ui/` (shadcn primitives; ported from the legacy `resources/js/Components/ui/*`, converted to TSX), `components/<feature>/`, `services/` (the **only** place HTTP happens; `services/api.ts` is the shared client, `services/types.ts` mirrors the contract), `hooks/`, `stores/`, `printing/`, `utils/` (`money.ts`).
- **API client:** same rules as the tablet's (Accept/Content-Type JSON, Bearer token, typed 422 errors with field messages, 401 → logout with a loop guard, friendly network errors). URLs are relative (`/api/v1/...`).
- **Money:** integer centavos only; formatted at render. The cart total is a checksum; the server computes every amount.
- **Selling:** layout ported from the legacy `Pages/Menu/Menu.jsx` + `Partials/CartSummary.jsx` (category grid, search, cart panel always visible). `POST /orders` with a ULID made when checkout opens; the same rules as the tablet's online sale (shift required, SC/PWD, line and order discounts with the manager PIN, table number, customer, split payments). Keyboard-first: `/` focuses search, `Enter` adds the highlighted product, `F2` opens payment, `Esc` closes dialogs.
- **Printing:** The ESC/POS builder, the documents and the routing are **shared with the tablet** through `packages/pos-core` (`@pos/core/printing/*`): same layouts, same routing rules, same print-config. Only the transport differs: each job is `POST /print-jobs` with a new ULID and the bytes in base64. The receipt printer per terminal is chosen and stored in `localStorage`. After a sale, the success screen polls `GET /print-jobs` every 2 s for up to 60 s and shows each job's status, with **Retry** on a failed one.
- **Layout:** desktop-first (≥1280 px), still usable down to 768 px; no horizontal scroll. Every list has loading, empty, error-with-retry and load-more (cursor) states; every form disables submit in flight and shows 422 messages under the fields.

### G. Build rounds (one approval for this section; built in order)
| Round | Backend | Web |
|---|---|---|
| **W1** | `devices.platform`; `print_jobs` + user and agent endpoints; agent and prune commands; `/pos` web route; tests | Scaffold, auth, device registration, shell and permission nav, **open-shift gate** (view the terminal's current shift and open one; close and X/Z-read stay in W2), Sell + checkout, print bridge client, order history + reprint, printers and receipt settings |
| **W2** | — | Shifts (open, cash in/out, X/Z-read, close), voids and refunds, Needs review list |
| **W3** | — | Catalogue (categories, products, images, recipes), staff and roles, customers |
| **W4** | — | Inventory, ingredients, units, suppliers, purchasing (PR, PO, receiving) |
| **W5** | — | Dashboard and reports with CSV export (legacy Recharts charts ported) |

Rounds W2–W5 use existing endpoints only; any gap is raised as an Open Question, never invented.

**Tests (backend):** device platform and `W` codes; print-job validation, idempotent replay, first-print dedupe, retry; agent token (503/401), claim ordering, `SKIP LOCKED`, stale reclaim, disabled-printer fail, result transitions and the 3-attempt cap, branch isolation; `print-agent:run --once` against a fake TCP listener.

---

## Feature: Category Kitchen Printer — DRAFT (v1.22)
Status: **DRAFT** (2026-10-09), waiting for approval.

**Goal:** a manager chooses, **on the category itself**, which kitchen or bar printer its products print to. This is on the tablet and on the web.

**What exists already (unchanged):** Printing (Phase 4) routes each item by its category.
- **Routes:** a kitchen or bar printer's `category_ids` lists the categories it prints. A category is routed to at most one printer per branch.
- **Default:** items in an unrouted category go to the default kitchen printer.
- **Management:** the Printers screens (tablet and web) manage this from the printer's side.

This feature adds the same control from the category's side. **No new table, and no change to `GET /print-config` or to how tickets are routed.**

### A. `Category` (admin endpoints only) gains `kitchen_printer`
| Field | Type | Nullable | Notes |
|---|---|---|---|
| `kitchen_printer` | `{ id, name, role: "kitchen" \| "bar", is_enabled }` | yes | The non-deleted printer **in the caller's branch** whose `category_ids` contains this category. `null` means the category is not routed, so its items go to the default kitchen printer. |

- **Where it appears:** on every admin category response (`GET /admin/categories`, `GET /admin/categories/{id}`, store, update, image).
- **Where it does not:** the POS read endpoint `GET /categories` and `GET /sync/catalogue` don't change.
- **Branch scope:** categories are shared by every branch but printers aren't, so the field is resolved for the caller's branch.

### B. Store and update accept `kitchen_printer_id`
`POST /api/v1/admin/categories` and `PATCH /api/v1/admin/categories/{id}` gain one optional field:

| Name | Type | Store | Update | Validation rules |
|---|---|---|---|---|
| `kitchen_printer_id` | integer\|null | optional | sometimes | `nullable`, `integer`. It must be a non-deleted `kitchen` or `bar` printer **in the caller's branch**; otherwise `422` on `kitchen_printer_id` with `Choose a kitchen or bar printer.` A disabled printer is allowed; the client shows a warning. |

**Behaviour** (in the same transaction as the category write):
- **A printer id:** the category is routed to that printer. If another printer in the branch had it, the route **moves**, exactly like `PATCH /admin/printers/{id}` with `category_ids`.
- **`null`:** removes the category's route in the caller's branch, so its items go to the default kitchen printer.
- **Field absent:** the routes don't change.
- **Permission:** routes are a printer setting. Sending `kitchen_printer_id` (any value, `null` included) also needs **`settings.manage`**, otherwise `403 "You don't have permission to change printer routing."`. A `product.manage`-only user can still edit everything else, as long as they leave the field out. Owner and Manager have both permissions.
- **Audit:** `printer.updated` on each printer whose `category_ids` changed (`{from, to}`), as the printer endpoints already record. `category.updated` stays as it is.
- **Errors:** the existing ones, plus `403` (routing without `settings.manage`) and `422` (`kitchen_printer_id`).

### C. Clients (tablet `mobile/` and web `web/`)
- **Category form:** a **Kitchen printer** select, shown only with `settings.manage`.
  - **Options:** `Default kitchen printer` (sends `null`; the hint names the current default, or says `No default kitchen printer is set` and that items won't print), then every kitchen and bar printer by name, with role and `Disabled` tags.
  - **Saving:** a changed choice is sent as `kitchen_printer_id`.
  - **Moving a route:** choosing a printer while the category is routed elsewhere says `Moves from <old printer> to <new printer>.`
  - **Disabled printer:** choosing one warns `This printer is disabled. Items won't print until it's enabled.`
  - **Printer list:** read from `GET /admin/printers` (`settings.manage`).
- **Category list:** a `Prints to` column on the web, or a chip on the tablet, showing the printer's name, `Default`, or `Disabled` with a warning tone.
- **After a save that changed the route:**
  - the tablet refreshes its cached print-config (as it does after a printer change);
  - the web invalidates its print-config and printer queries.
- The Printers screens keep their category picker, and both ways stay in sync, because the server holds one set of routes.

### D. Build
- **backend-agent:** CategoryResource `kitchen_printer` (eager-loaded per branch, no N+1); the request rules; the route move in the category store/update action, reusing the printer routing logic; the permission check; tests (field resolution per branch, move, clear, absent, wrong role or branch → 422, no `settings.manage` → 403, audit on both printers, no change to `/categories` or `/sync/catalogue`).
- **frontend-agent** (tablet) and **web-agent** (web), in parallel: section C.
- **Shared types:** the main session adds `kitchen_printer` and `kitchen_printer_id` to `packages/pos-core/src/contract/types.ts` once this is approved.
- **Flags:** no migration (the existing route table is reused), no new `.env` keys, and no new packages.

---

## Feature: Purchase Request & Order PDF — APPROVED (v1.24)
Status: **APPROVED** (2026-10-12), revised the same day: one PDF per purchase request or purchase order. **There is no whole-list printout**; the user removed it.

**Goal:** a clean, printable PDF of **one** purchase request or purchase order with all its items, to file, sign, or send to a supplier. It is made from the browser's Save as PDF.

**Scope:**
- **Web only.** Built with the browser's own print dialog (Save as PDF): no new package and no backend change.
- The tablet would need `expo-print`, which means a new package and a new Dev Client build. It is left for later.

**Data:** existing endpoints only, nothing new.
- `GET /api/v1/purchase-requests/{ulid}` and `GET /api/v1/purchase-orders/{ulid}`: the document itself.
- `GET /api/v1/print-config` (any user): the branch name and `settings.receipt_header_lines` (business name, address, TIN) for the letterhead.
- `GET /api/v1/admin/suppliers/{id}` (when the caller may read suppliers): the supplier's contact person, number, email and address on a PO. If it can't be read, only the supplier name is shown.

### A. Where the button is
- **Each row** of the Purchase requests, Purchase orders and Receiving lists has a small **print icon button** (label "Print {PR/PO number}") in a last column. It prints that one request or order.
  - Clicking it doesn't open the row.
  - There is no Print / PDF button for the whole list.
- **Purchase request detail** (`/purchasing/requests/:ulid`) and **purchase order detail** (`/purchasing/orders/:ulid`): a **Print / PDF** button in the page header.
- It opens a print view in a new tab:
  - `/purchasing/requests/:ulid/print`;
  - `/purchasing/orders/:ulid/print?supplier=<id>` (`supplier` is optional).
- **Visibility:** whoever can open the detail page can print it. No new permission.

### B. The print view
- A plain A4 portrait page outside the app shell: no sidebar, white background, black text, one accent colour for headings.
- **On screen**, a toolbar sits at the top and is hidden when printing: **Print / Save as PDF** (calls `window.print()`), **Back**, and on a PO the **Supplier** picker (below).
- The print dialog opens automatically once the data has loaded.
- **Repeated on every printed page:** the table header row.
- **Page footer:** "Printed {date, time} by {user} · {PR/PO number} · Page n of m".
- Money is formatted from integer centavos (₱1,234.50). Quantities use the existing `@pos/core` quantity formatting with their unit.
- Dates and times are shown in the branch's timezone (`print-config.branch.timezone`).
- **The PDF file name** is the document number, e.g. `PR-MAIN-2026-00003.pdf`.

### C. Purchase request layout
1. **Letterhead** (left): the receipt header lines, or the branch name when there are none. **Title** (right): **PURCHASE REQUEST**, the PR number, and a status chip.
2. **Details** (two columns):
   - Requested by;
   - Date requested;
   - Date needed ("—" when none);
   - Status;
   - Purchase order (its number and status, or "—");
   - Remarks (full width, only when set).
3. **Items table, every item:**

   | # | Item | Supplier | Qty | Unit | Est. unit price | Est. amount | Decision | Remarks |
   |---|---|---|---|---|---|---|---|---|

   - **Est. amount** is `round_half_up(estimated_unit_price_cents × qty)`, or "—" when there is no price.
   - **Decision** is Pending, Approved or Declined. A declined item also shows its reason under the remarks, and its row is greyed.
4. **Totals** (right):
   - Estimated total of all items;
   - Estimated total of approved items;
   - "Items without a price: N" when any item has no price.
5. **Signature lines:**
   - **Requested by:** the requester's name;
   - **Approved by:** the approver's name, when every decided item was decided by the same person; otherwise blank.

   Each line has room for a signature and a date.
6. When the status is not approved, a small **NOT APPROVED — FOR REVIEW ONLY** band runs under the title.

### D. Purchase order layout
1. **Letterhead:** as on the PR. **Title:** **PURCHASE ORDER**, the PO number, and a status chip with the receiving status.
2. **Details:**
   - PO date (the first timeline entry);
   - From request (the PR number);
   - Created by;
   - Approved by and approved at;
   - Expected delivery;
   - Remarks.
3. **Lines are grouped by supplier**, because a PO can hold several suppliers. For each supplier there is:
   - a block with the supplier's name, contact person, number, email and address;
   - then its lines:

     | # | Item | Qty | Unit | Unit price | Amount | Received | Remaining |
     |---|---|---|---|---|---|---|---|

   - then the supplier subtotal (Σ `line_total_cents`).
4. **Grand total:** `total_cents`.
5. **Signature lines:** Prepared by (the creator), Approved by (the approver), and Received by (blank).
6. **Supplier picker** (toolbar):
   - **All suppliers** (the default) prints every group, each starting on a new page when there is more than one.
   - **Picking one supplier** prints only that supplier's lines, its subtotal as the total, and a "Lines for {supplier} only" note. This is the copy to send to that supplier.
7. **When the PO is not approved**, the band reads **NOT APPROVED — DO NOT SEND TO SUPPLIER**. A declined PO also shows the decline reason.
8. **Received / Remaining** columns are left out when the PO's `receiving_status` is `not_received`. That keeps a fresh order clean to send.

### E. States
- **Loading:** a spinner, and the print dialog doesn't open yet.
- **Errors:** a 404 shows "This request was not found." or "This order was not found."; other errors show Retry.
- **A 403** shows "You don't have access to this document."
- The print-config or supplier reads failing never block the document. It prints with the branch name, or with the supplier name only.

### F. Build
- **web-agent:**
  - the two print routes (one per document);
  - the shared print layout components and print CSS:
    - `@page { size: A4; margin: 14mm }`, portrait;
    - `thead` repeated;
    - rows never split across pages;
  - the buttons on the two detail pages and on each list row;
  - unit tests for the totals and the supplier grouping.
- Run lint and build.
- No backend, mobile or `packages/` changes.

### G. Revision 2: the tablet (APPROVED v1.27, 2026-10-13)
Status: **APPROVED** (2026-10-13, as drafted).

**Goal:** the same PDF of one purchase request or one purchase order on the tablet, with the same layout as the web (§B–§E).

**Choices made (user, 2026-10-13):**
- It is built with **`expo-print`**, a native module, so it needs a **new EAS Dev Client build**.
- On the purchase request detail, the purchase order row keeps **Open** (goes to the PO screen) and gains **PDF** beside it (opens that PO's PDF).

**Data:** the same existing endpoints as §Data. No backend change.

**One layout for both clients:**
- The document model (totals, supplier grouping, decision labels, the not-approved band) moves from `web/src/components/purchasing/print/printModel.ts` into `@pos/core/purchasing/printModel`, so both clients compute it once.
- `@pos/core/purchasing/printHtml` builds the complete A4 HTML document (inline CSS, no external fonts or images) from that model. The tablet prints it; the web keeps its React print pages, but they read the shared model.

**Where the buttons are (tablet):**
- **Purchase request detail:** a **PDF** button in the header. On the purchase order row, **Open** (unchanged) plus **PDF**.
- **Purchase order detail:** a **PDF** button in the header. When the PO has more than one supplier, it first asks **All suppliers** or one supplier (§D.6).
- The **Receiving** detail has the same PDF button as the PO.
- **Visibility:** whoever can open the detail can make its PDF. No new permission.

**What PDF does:**
- It fetches what's missing (the document, `print-config`, and the suppliers when readable), builds the HTML, and opens a **preview sheet** with two actions:
  - **Print / Save as PDF:** Android's print screen (`Print.printAsync`), where the user picks a printer or "Save as PDF".
  - **Share:** the PDF file (`Print.printToFileAsync`), renamed to the document number (e.g. `PR-MAIN-2026-00003.pdf`), sent through the existing `expo-sharing`.
- **The footer** "Printed {date, time} by {user} · {number} · Page n of m" uses the same `@page` margin boxes as the web. Where the print engine doesn't support them, it falls back to the footer at the end of the document without page numbers, as on the web.
- **States:** a spinner on the button while loading. A 404, a 403 or other errors show the §E messages in a banner, with Retry. A failing `print-config` or supplier read never blocks the PDF.
- **Online only.** Offline, the button is disabled and reads "Needs a connection".

**Build:**
- **frontend-agent** (named editor of `packages/pos-core/`):
  - move the print model into `purchasing/printModel.ts` with its tests;
  - add `purchasing/printHtml.ts` (§C and §D in HTML, A4 portrait, 14 mm margins, repeated `thead`, rows never split) with snapshot tests;
  - the tablet buttons, the preview sheet, and `npx expo install expo-print`.
- **web-agent:** after the move, import the model from `@pos/core/purchasing/printModel` and delete the local copy. The web output must not change.
- **After merging:** run `eas build --profile development` and install the new APK.


---

## Feature: Reports PDF — DRAFT (v1.25)
Status: **DRAFT** (2026-10-12), waiting for approval.

**Goal:** a **Print / PDF** button on the web Reports page. It prints the report on screen as a clean document, made from the browser's Save as PDF, the same way as purchase requests and orders.

**Scope:**
- **Web only.** There is no backend change, no new package and no `packages/` change.
- It reuses the print layout from "Purchase Request & Order PDF": the letterhead, the footer with "Page n of m", the money and quantity formats, and the auto-opening print dialog.

### A. The button
- **Print / PDF** sits next to **Export CSV** in the Reports header, and is disabled while the report is loading.
- It opens `/reports/print?view=…` in a new tab. The query carries exactly what the screen shows:
  - `view`: `sales`, `inventory` or `purchasing`;
  - `kind` for inventory: `products` or `ingredients`;
  - `from` and `to`;
  - and every option of that view, such as the sales `group_by` and the inventory or purchasing filters.
- **Access:** the same permissions as the Reports page. A user who can't see a report gets "You don't have access to this report."
- **Data:** the print view loads the report from the same endpoints the screen uses, with the same parameters. Nothing new.

### B. Common layout
1. **Letterhead** (left): the receipt header lines, or the branch name. **Title** (right): **SALES REPORT**, **INVENTORY REPORT: PRODUCTS**, **INVENTORY REPORT: INGREDIENTS** or **PURCHASING REPORT**.
2. **Period:** "1 Oct 2026 – 12 Oct 2026" in the branch timezone. Under it, the options in words, for example "Grouped by: Product · Category: Drinks · Status: Low stock", or "All" when nothing is filtered.
3. **Summary:** a box grid of the report's `totals`, with the labels the screen uses.
4. **Table:** every row of `rows`, with a totals row at the bottom when the report has column totals. The header row repeats on every page, and rows never split.
5. **When `meta.truncated` is true**, a notice reads "This report is cut short. Narrow the dates or filters to see every row."
6. **Footer:** "Printed {date, time} by {user} · {report title} · Page n of m".
7. **File name:** for example `Sales-report-2026-10-01-to-2026-10-12`.
8. **Charts are not printed**, only the figures and tables, so it stays clean in black and white.

### C. Per report
- **Sales** (A4 portrait):
  - **Summary:** orders, items sold, gross sales, discounts, net sales, VAT, voids (count and amount), refunds (count and amount), net after refunds.
  - **Table:** grouped as on screen (day, product, category, payment or cashier). Columns: label, orders, qty, gross, discounts, net, refunds, net after refunds. A column that is null for that grouping is left out.
- **Inventory, products** (A4 landscape):
  - **Summary:** tracked, low, out, stock value, received, sold, returned, wasted, adjusted.
  - **Table:** product, category, opening, received, sold, returned, wasted, adjusted, closing, reorder level, status, unit cost, stock value.
- **Inventory, ingredients** (A4 landscape): the same layout, with the ingredient report's own columns, quantities shown with their units.
- **Purchasing** (A4 landscape):
  - **Summary:** requests, items, approved, declined, pending, POs by status, ordered, received, remaining.
  - **Table:** PR no, date, requested by, item, supplier, requested qty + unit, decision, PO no, PO status, ordered, received, remaining, unit price, ordered amount, received amount.

### D. States
As in "Purchase Request & Order PDF" §E:
- **Loading:** a spinner, and the print dialog doesn't open yet.
- **Errors:** "You don't have access to this report." on a 403; Retry on any other error.
- **No data:** an empty report prints its summary and "No rows for this period."

### E. Build
- **web-agent:**
  - the `/reports/print` route, outside the app shell and behind sign-in and the same permission checks;
  - the button;
  - the three print views on top of the existing print layout, made portrait or landscape per report;
  - lint and build.

---

## Feature: Dine-in Tables & Tabs — APPROVED (v1.26)
Status: **APPROVED** (2026-10-13, as drafted).

**Goal:** an **optional** dine-in mode. Guests order in rounds at a table, the kitchen gets each round as it is sent, and the bill is paid at the end, whole or split. **Pay-as-you-order stays the default** and doesn't change.

**Choices made (user, 2026-10-13):**
- **Open tabs live on the server.** Any tablet or web terminal can see a table, add to it and settle it. Tab actions need a connection. Pay-now sales keep working offline, as today.
- **A branch setting turns it on, and it is off by default.** When it's off, nothing changes on either client.
- **Scope:** a table list with open tabs and kitchen rounds; transfer and merge; split bill (by item or equally); a printed bill and an optional service charge.
- **Cancelling an item already sent to the kitchen** needs `sale.void` or a manager PIN, plus a reason. It prints a VOID kitchen ticket and is audited. Items not yet sent are only in the device's cart, so removing them needs nothing.

**How it fits the existing design:**
- **A tab is not an order.** Orders stay "paid sales" with the same statuses, numbering, shifts, reports, voids and refunds. Settling a tab **creates a normal order** (or several, when split by item). Each order links back to its tab.
- **The cart stays client-only** (PROJECT_MEMORY decision #5). The device builds a round in its cart, and **Send** saves the round to the tab on the server. The server only holds what was sent to the kitchen.
- **Prices are snapshotted when a round is sent.** The guest pays the price on the menu when they ordered, even if it changes before settling, and a dish taken off the menu after it was served can still be paid for.
- **Stock depletes at settlement** through the existing sale path (one stock path). **Send** checks stock for `track_stock` products the way an online sale does. **Settlement never blocks for stock**, because the food is already served (same reasoning as decision #7).

**Not in this feature:** a floor-plan editor (tables are a grouped grid), reservations, a kitchen display screen, offline tabs, waiter-only roles, moving single items between tabs (use split + merge), and tips.

**Rounds:** **T1:** settings, tables admin, tabs, rounds, item cancel, whole-bill settlement, printed bill, service charge. **T2:** transfer, merge, split by item, split equally.

### A. Settings and permission
- **`BranchSettings` gains** (both are in `GET/PATCH /admin/settings` and in `GET /print-config`'s `settings`):

| Field | Type | Default | PATCH rule |
|---|---|---|---|
| `dine_in_enabled` | boolean | `false` | `boolean` |
| `service_charge_bps` | integer | `0` (no service charge) | `integer`, `min:0`, `max:2000` (0–20%) |

- **Turning dine-in off while tabs are open** returns `409 "Close the 3 open bills first."`
- **While dine-in is off,** every endpoint in §C and §D returns `409 "Dine-in tables are turned off in Settings."` (admin tables in §B still work, so tables can be set up first).
- **No new permission slug:**
  - managing tables needs `settings.manage`;
  - tab actions need `sale.create`;
  - cancelling a sent item needs `sale.void` or a manager PIN (§D.4).

### B. Admin: tables (`settings.manage`)
| Method | URI | Route name | Response |
|---|---|---|---|
| GET | `/api/v1/admin/tables` | `v1.admin.tables.index` | cursor envelope of `DiningTable`, ordered by `area`, `sort_order`, `name` (`per_page` 1–100, default 100) |
| POST | `/api/v1/admin/tables` | `v1.admin.tables.store` | 201 `{data: DiningTable}` |
| PATCH | `/api/v1/admin/tables/{id}` | `v1.admin.tables.update` | 200 `{data: DiningTable}` |
| DELETE | `/api/v1/admin/tables/{id}` | `v1.admin.tables.destroy` | 204 (soft delete) |

**`DiningTable`:** `{ "id": 5, "name": "5", "area": "Patio", "seats": 4, "sort_order": 0, "is_active": true, "updated_at": "…" }`

**Rules:**
- `name`: `required`, `string`, `max:10`, `regex:/^[A-Za-z0-9 -]+$/` (the `table_no` rule, so it fits `orders.table_no`), trimmed, unique among the branch's non-deleted tables (`422 "There is already a table named 5."`).
- `area`: `nullable`, `string`, `max:30`.
- `seats`: `required` on create, `integer`, `1–50`.
- `sort_order`: `integer`, `0–9999`, default `0`.
- `is_active`: `boolean`, default `true`.

**Conflicts:**
- Deleting or deactivating a table with an open tab returns `409 "Table 5 has an open bill."`
- Renaming a table with an open tab is allowed. Orders settled earlier keep the old name in `table_no`.

**Audit:** `table.created`, `table.updated` (`{from, to}`), `table.deleted`.

### C. Tables view
**`GET /api/v1/tables`** (`sale.create`) returns the branch's **active** tables in the admin order, each with its open tab summary. It uses the cursor envelope (`per_page` 1–100, default 100).
```json
{ "id": 5, "name": "5", "area": "Patio", "seats": 4,
  "tab": { "ulid": "01K…", "guests": 3, "opened_at": "…", "opened_by": { "id": 3, "name": "Cara" },
           "item_count": 7, "remaining_cents": 124500, "rounds_count": 2, "updated_at": "…" } }
```
- `tab` is `null` when the table is free.
- `remaining_cents` = Σ `unit_price_cents × remaining_qty`. It is before discounts and service charge, for display only.
- **The clients poll** every 15 seconds while the view is open, and after every tab action. There are no websockets.

### D. Tabs (`sale.create`; online only)
Every mutation takes `Idempotency-Key` (a ULID the client makes when the action starts) and replays the same response, as for orders.

**Shared object `Tab`:**
```json
{
  "ulid": "01K…", "status": "open",
  "table": { "id": 5, "name": "5", "area": "Patio" },
  "guests": 3, "customer": null, "notes": null,
  "opened_at": "…", "opened_by": { "id": 3, "name": "Cara" },
  "closed_at": null, "merged_into_ulid": null,
  "rounds_count": 2,
  "items": [ {
    "id": 41, "round_no": 1, "product_id": 4, "product_name": "Sisig", "category_id": 2,
    "unit_price_cents": 22500, "is_vatable": true,
    "qty": 2, "settled_qty": 0, "cancelled_qty": 0, "remaining_qty": 2,
    "notes": "Extra spicy", "added_at": "…", "added_by": { "id": 3, "name": "Cara" }
  } ],
  "orders": [ { "ulid": "01K…", "invoice_no": "INV-MAIN-00000123", "total_cents": 50000 } ],
  "remaining_cents": 124500,
  "updated_at": "…"
}
```
`status` is one of `open`, `closed`, `merged` or `cancelled`. `items` are ordered by `round_no`, then `id`. A tab holds at most **200** item lines.

| # | Method | URI | Route name | Round |
|---|---|---|---|---|
| 1 | POST | `/api/v1/tabs` | `v1.tabs.store` | T1 |
| 2 | GET | `/api/v1/tabs/{ulid}` | `v1.tabs.show` | T1 |
| 3 | PATCH | `/api/v1/tabs/{ulid}` | `v1.tabs.update` | T1 |
| 4 | POST | `/api/v1/tabs/{ulid}/rounds` | `v1.tabs.rounds` | T1 |
| 5 | POST | `/api/v1/tabs/{ulid}/items/{id}/cancel` | `v1.tabs.items.cancel` | T1 |
| 6 | POST | `/api/v1/tabs/{ulid}/settle` | `v1.tabs.settle` | T1 (split in T2) |
| 7 | POST | `/api/v1/tabs/{ulid}/close` | `v1.tabs.close` | T1 |
| 8 | POST | `/api/v1/tabs/{ulid}/transfer` | `v1.tabs.transfer` | T2 |
| 9 | POST | `/api/v1/tabs/{ulid}/merge` | `v1.tabs.merge` | T2 |

A tab in another branch or one that doesn't exist returns `404`. Actions 3–9 on a tab that isn't `open` return `409 "This bill is already closed."`

**1. Open:** body `ulid` (= the key), `table_id` (`required`, an active table in the branch), `guests` (`integer`, `1–99`, default the table's `seats`), `customer_id` (`nullable`, existing customer), `notes` (`nullable`, `max:255`).
- When the table already has an open tab: `409 "Table 5 already has an open bill."` A unique `open_table_id` column enforces this under concurrency.
- 201 `{data: Tab}`. Audit: `tab.opened`.

**3. Update:** `guests`, `customer_id` and `notes`, all partial. 200 `{data: Tab}`.

**4. Send a round:** body `ulid` and `items` (`array`, `1–100`). Each item has `product_id`, `qty` (`1–999`) and `notes` (`nullable`, `max:120`): the same rules as `POST /orders` items, with no discounts.
- **Menu checks** are the same as `POST /orders` check 2, with the same messages.
- **Stock check** (lock the `stock_levels` rows): for a `track_stock` product, the demand is this round's quantity **plus its `remaining_qty` on every open tab in the branch**. When that exceeds on-hand: `422` on `items.{i}.qty`: `Only <n> "<name>" left in stock.`, where `n` = on-hand − already on open tabs, never below 0.
- **200-line cap:** `422` on `items`: `This bill has too many lines. Settle part of it first.`
- **On success:**
  - lines are added with `round_no` = `rounds_count + 1`, snapshotting `product_name`, `category_id`, `category_name`, `sku`, `unit_price_cents` and `is_vatable`;
  - the response is 200 `{data: Tab, round_no}`;
  - audit: `tab.round_sent`.
- **The client prints the kitchen ticket** for that round only (§F), the same way a sale prints today: the tablet over TCP, the web as a `kitchen` print job.

**5. Cancel a sent item:** body `qty` (`1` … `remaining_qty`), `reason` (`required`, `max:255`) and `authorization` (`nullable`; `user_id`, `pin`).
- **Authority:** the same rules and messages as a void (Phase 7 *Permissions*). It needs `sale.void`, or an approver with `sale.void` and a PIN; the PIN goes through the shared limiter (`429`).
- **On success:** `cancelled_qty += qty`, and a `tab_item_cancellations` row records `qty`, `reason`, `cancelled_by` and `authorized_by`. The response is 200 `{data: Tab}`, and the audit entry is `tab.item_cancelled`.
- **The client prints a `kitchen_void` ticket** for that quantity.

**6. Settle:** creates **one order** from some or all of the tab's remaining quantities.
- **Body:** the `POST /orders` body, with these differences:
  - `items.*` is `{ tab_item_id, qty, discount, sc_pwd }` (no `product_id` or `notes`). `qty` must be ≤ `remaining_qty`.
  - `items` may be **omitted** to settle **everything remaining**.
  - `customer_id`, `notes`, `discount`, `sc_pwd`, `discount_authorization` and `client_total_cents` keep their rules. In `headcount` mode, `sc_pwd.diners` defaults to the tab's `guests`.
  - `service_charge` (`boolean`, default `true`): when `false`, no service charge is added and the order records `service_charge_waived = true`.
  - `split_count` (`nullable`, `integer`, `2–10`, **T2**): split equally (§E).
  - `payments`: `max:10`. Without `split_count`, at most one `cash` (as today). With `split_count`, see §E.
- **Checks:**
  - the same as `POST /orders` checks 1, 3, 4, 5 and 6, plus the open-shift rule;
  - **no** menu or stock checks: the snapshots are the price, and the food was served;
  - a `tab_item_id` not on this tab returns `422` on `items.{i}.tab_item_id`;
  - when another device settled or cancelled the same quantity first (re-checked under a row lock on the tab), the response is `409 "This bill changed on another device. Review it again."`
- **Pricing** uses the snapshots in Core Sale steps 1–9, then the service charge (§E).
- **On success:** the existing `RecordOrder` path runs (numbers, lines, payments, stock movements, audit `order.completed`), plus:
  - `orders.tab_id`, `table_no` = the table's name, and `order_items.tab_item_id`;
  - `settled_qty` increases on each tab item;
  - when nothing remains, the tab is set to `closed` with `closed_at` and `closed_by`, and the table is freed (audit `tab.closed`).
- **Response:** 201 `{data: Order, tab: Tab}`.
- **The client prints the receipt** with no kitchen ticket, because the rounds were already sent.

**7. Close:** only when no remaining quantity is left (everything is cancelled, or the tab was opened by mistake).
- The status becomes `closed` if the tab has orders, otherwise `cancelled`.
- When quantity remains: `409 "Settle or cancel the remaining items first."`

**8. Transfer (T2):** body `table_id`, an active, free table.
- When the target table is occupied: `409 "Table 7 is occupied. Merge the bills instead."`
- Audit: `tab.transferred` (`{from, to}`).

**9. Merge (T2):** body `into_ulid`, another open tab in the branch.
- Every remaining quantity moves to the target as new lines in the target's next round. Prices and notes are kept, and no kitchen ticket is printed.
- `guests` are added together. The source becomes `merged` with `merged_into_ulid`.
- Orders already settled from the source stay linked to it.
- Response: 200 `{data: Tab}` (the target). Audit: `tab.merged` on both tabs.

### E. Service charge and equal split (shared pricing in `@pos/core/sale`)
- **Service charge** applies only to tab settlements, when `service_charge_bps > 0` and `service_charge` is not `false`:
  - `S = rhu(T × service_charge_bps, 10000)`, where `T` is the order total after all discounts (Core Sale step 7, after SC/PWD).
  - `total_cents = T + S`.
  - `S` is not discounted, and for now it is **outside the VAT figures** (not vatable, not exempt). Like the SC/PWD rates, this is a one-line change if the accountant says otherwise.
  - The checksum and the payments cover `total_cents`.
- **Equal split (`split_count = N`):** share `k` (1-based) = `floor(total/N)`, plus 1 centavo for `k ≤ total mod N`.
  - `payments` must have exactly `N` entries, in share order; otherwise `422` on `payments`: `Add one payment per share (3).`
  - Each GCash payment must equal its share. Each cash payment's tendered amount must be ≥ its share, and its change is its own.
  - Several `cash` payments are allowed **only** here.
  - `orders.split_count = N`.
- **Split by item** is just several settlements of different `items`. Each one is a normal order with its own invoice and receipt.
- **Refunds** (Phase 7): a partial refund doesn't return service charge. The refund that leaves **no** refundable quantity also returns `S`. A void returns everything, as today.

### F. Printed documents (`@pos/core/printing`)
- **Kitchen ticket for a round:** the existing layout, with `TABLE 5` in double size, then `ROUND 2 · 3 guests`, the server's name, and the round's items only.
- **Kitchen void for a cancel:** the existing `kitchen_void` layout with the table and the cancelled quantity.
- **Bill** (new; print-job `kind: "bill"` for web terminals, sent to the receipt printer):
  - the header lines, `BILL — NOT A RECEIPT`, the table, guests and time;
  - the remaining items consolidated by product and price;
  - the subtotal, the service charge (when on), and the total;
  - optionally `Split 3 ways: ₱415.00 each`.
- **Receipt:**
  - a `Service charge (10%)` row before the total when `S > 0`;
  - with `split_count`, one receipt per share, each showing the full order plus `Share 1 of 3 · ₱415.00 · Cash`.

### G. Changes to existing shapes
- **`Order`** and **`OrderSummary`** gain `tab_ulid` (nullable), `service_charge_cents` (integer, `0`) and `split_count` (nullable). They go right after `table_no`.
- **Sales figures:**
  - `ShiftReport`, X/Z-read, the sales report summary and the dashboard `sales` gain `service_charge_cents`, shown on its own row;
  - product and category sales stay line-based and exclude it;
  - `net_sales_cents` (Σ `total_cents`) already includes it, so it matches the payments and the drawer (clarified at approval);
  - expected cash already includes it through the payments.
- **The offline outbox is unchanged:** settlements are never queued.

### H. Data model (backend)
- **`dining_tables`:** `id`, `branch_id`, `name` (10), `area` (30, null), `seats`, `sort_order`, `is_active`, timestamps, soft deletes.
- **`tabs`:**
  - `id`, `ulid` (unique), `branch_id`, `table_id`;
  - `open_table_id` (nullable, **unique**: equal to `table_id` while open, `null` otherwise);
  - `status`, `guests`, `customer_id`, `notes`, `rounds_count`;
  - `opened_by`, `opened_at`, `closed_by`, `closed_at`, `merged_into_tab_id`, `device_id`, timestamps.
  - Index `(branch_id, status)`.
- **`tab_items`:** `id`, `tab_id`, `round_no`, `product_id`, the snapshots, `qty`, `settled_qty`, `cancelled_qty`, `notes`, `added_by`, `added_at`.
- **`tab_item_cancellations`:** `ulid`, `tab_item_id`, `qty`, `reason`, `cancelled_by`, `authorized_by`, `created_at`.
- **New columns:**
  - `orders`: `tab_id` (null, indexed), `service_charge_cents` (default 0), `service_charge_waived` (bool), `split_count` (null);
  - `order_items`: `tab_item_id` (null).
- **Settings keys:** `dine_in_enabled` and `service_charge_bps`.

### I. Clients (tablet and web; the same behaviour)
- **Settings:** a **Dine-in** card with the on/off switch and the Service charge %.
- **Admin → Tables** (`settings.manage`): a list grouped by area, plus create, edit, delete and active. In the sidebar it shows only when dine-in is on.
- **Sell, when dine-in is on:** a **Pay now | Tables** switch at the top. Pay now is today's screen, unchanged.
  - **Tables view:** cards grouped by area. A card shows the name, Free or Occupied, guests, the remaining amount and the elapsed time (amber after 90 minutes).
  - **A free table** opens the tab (asking for guests). **An occupied table** opens it.
  - **Tab screen:** the menu and cart as on Sell, with a header `Table 5 · 3 guests`.
    - **Send to kitchen** sends the cart as a round, prints the round's ticket and clears the cart.
    - **Bill items** lists the sent items by round, each with **Cancel** (reason + manager PIN).
    - The other actions are **Print bill**, **Pay** (whole bill, **By item** or **Equally** in T2), and **Transfer** / **Merge** (T2).
  - **Pay** opens the existing checkout with the tab's lines, the service charge toggle and, for an equal split, one payment step per share.
- **Offline:** the Tables view shows `Tables need a connection.` and its actions are disabled. Pay now still works offline.
- **Orders:** an order from a tab shows `Table 5` (already done) and the service charge in the detail.
- **Errors:** `401` signs out as today. `409` messages show in a dialog that reloads the tab. `422` errors show on their fields.

### J. Build
- **packages/pos-core** (owned by **frontend-agent**):
  - contract types for §A–§G;
  - service charge and equal-split share math in `sale/` (worked example below);
  - the round kitchen ticket, the bill and the receipt additions in `printing/`.
- **backend-agent:**
  - migrations, models and policies;
  - the actions for §B–§D, reusing `RecordOrder` for settlement;
  - the settings keys, the print-job kind `bill` and the report fields.
  - **Tests:** one open tab per table under concurrency; idempotent replays; the stock check across open tabs; no stock block at settlement; snapshot pricing after a price change; cancel authority; settle conflict `409`; partial settlements closing the tab; transfer and merge; worked example K; refund of `S`; dine-in off → `409`; branch isolation.
- **frontend-agent** (`mobile/`) and **web-agent** (`web/`): §I.

**Worked example K** (both sides test against it): worked example B as a tab settled whole with `service_charge_bps = 1000` → `T = 25700`, `S = 2570`, `total_cents = 28270`. With `split_count = 3`, the shares are `9424 · 9423 · 9423`.

---

## Feature: Dashboard Period Filter — APPROVED (v1.28)

The dashboard's sales figures can be viewed for a **day**, a **month** or a **year**, and staff can step back to earlier periods. Only the `sales` section changes. Catalogue, staff, customers, activity and insights stay "right now" snapshots, as before.

### §A. GET /api/v1/dashboard: new query params
| Name | Type | Required | Rules | Notes |
|---|---|---|---|---|
| `period` | string | no | `in:day,month,year` | Default `day` (today's behaviour). |
| `date` | string | no | `date_format:Y-m-d`, not after the branch's current business date | Any business date inside the wanted period. Default: the current business date. `2026-10-05` with `period=month` means October 2026. |

- A `date` after the current business date → `422` on `date`: `The date can't be in the future.`
- Invalid `period` → `422` on `period`.
- Both params only affect `sales`. Without them the response is unchanged.

### §B. The period range
"Today" is the branch's current business date (`T`). The anchor `D` is `date` (or `T`).

| `period` | `date_from` | `date_to` |
|---|---|---|
| `day` | `D` | `D` |
| `month` | the 1st of `D`'s month | the month's last day, **or `T`** when the month is the current one |
| `year` | 1 January of `D`'s year | 31 December, **or `T`** when the year is the current one |

Months and years are calendar months and years of **business dates** (the `orders.business_date` column), so a sale made at 01:00 before `day_start_time` counts in the previous business day, as everywhere else.

### §C. `sales` section changes
Every existing figure is now computed over `date_from … date_to` instead of today:
`orders_count`, `items_sold`, `gross_sales_cents`, `discounts_cents`, `net_sales_cents`, `vat_amount_cents`, `average_order_cents`, `by_payment_method`, `top_products` (max 5 over the period), `voids_count` (by the order's business day), `refunds_cents` (by the refund's business day), `net_after_refunds_cents`, the SC/PWD figures and `service_charge_cents`. The definitions do not change (shared `SalesFigures`).

New fields:
```json
"sales": {
  "period": "month",
  "date_from": "2026-10-01",
  "date_to": "2026-10-14",
  "business_date": "2026-10-14",
  "trend": {
    "unit": "day",
    "buckets": [
      { "start": "2026-10-01", "orders_count": 31, "net_sales_cents": 1045000 },
      { "start": "2026-10-14", "orders_count": 12, "net_sales_cents": 403000 }
    ]
  },
  "...": "all existing fields, now over the period"
}
```
| Field | Type | Notes |
|---|---|---|
| `period` | `"day" \| "month" \| "year"` | Echo of the request (default `day`). |
| `date_from`, `date_to` | `YYYY-MM-DD` | The range from §B, inclusive. |
| `business_date` | `YYYY-MM-DD` | Unchanged meaning: the **current** business date `T`. |
| `trend.unit` | `"day" \| "month"` | `day` for `period=day` and `month`; `month` for `period=year`. |
| `trend.buckets[]` | array | Oldest first, 0-filled, see below. |
| `trend.buckets[].start` | `YYYY-MM-DD` | The bucket's first business date (for a month bucket, the 1st). |
| `trend.buckets[].orders_count`, `net_sales_cents` | integer | Same definitions as `last_7_days`. |

**Buckets**
- `day`: the 7 business days ending on `D` (the current "last 7 days" chart, anchored on the chosen day).
- `month`: one bucket per day from `date_from` to `date_to` (up to 31).
- `year`: one bucket per month from January to `date_to`'s month (up to 12).

`last_7_days` is **kept unchanged** (the 7 days ending on `T`) so tablets on an older build keep working. New client code reads `trend` instead. It will be removed in a later version.

### §D. Clients (tablet and web, same behaviour)
- **Filter** in the dashboard band: a segmented control `Day · Month · Year` (default Day), and a date stepper `‹ label ›`:
  - labels: `Tue, 14 Oct 2026` · `October 2026` · `2026`; with the current period, `Today` · `This month` · `This year`.
  - `‹` goes to the previous day/month/year; `›` is disabled on the current period.
  - Switching the segment keeps the anchor date (e.g. 5 Oct, Month → October).
  - The choice is not saved: the dashboard opens on Day / today.
- **Labels follow the period:** stat cards read "Net sales", "Orders", "Average ticket" with the period label as a caption; the chart title becomes `Net sales, last 7 days` · `Net sales by day, October 2026` · `Net sales by month, 2026`; empty state `No sales on this day` · `in this month` · `in this year`.
- **Chart:** the same green area chart, drawing `trend.buckets` (x labels: day of week for `day`, day number for `month`, month short name for `year`).
- **Only the sales part refetches** visually; the other cards keep showing (they are in the same response, unchanged).
- The stock-alert card and insights are not period-based and keep showing current state.
- `401` and `422` handled as today (a `422` on `date` resets the filter to Day / today).

### §E. Not in this feature
Comparison with the previous period (the trend badge, Q-041), custom date ranges (the Reports screen already has them), and period filters on the activity or staff sections.

### §F. Backend notes
- `BuildSalesSection` takes the resolved range; the request is validated by a new `DashboardRequest`.
- The year query uses the existing `(branch_id, business_date)` index on `orders`; the month buckets of a year group by `YEAR(business_date), MONTH(business_date)`.
- Tests: default request unchanged; day/month/year ranges and clamping to `T`; past month full range; bucket counts (7 / days in range / months in range) and 0-fill; future date `422`; `last_7_days` still anchored on `T`; refunds and voids counted by their own business day inside the range.

---

## Feature: Table Management — APPROVED (v1.29)
Status: **APPROVED** (2026-10-26, as drafted, with the defaults below). Builds on Dine-in Tables & Tabs (v1.26) and changes none of its rules unless stated here.

**Goal:** give managers one place to run the dining room: a live status board with the pending payments, a floor plan, and reservations. Tables stay manageable while dine-in is off.

**Choices made (user, 2026-10-26):** all four: a live status board, a floor plan, reservations that hold a table, and Tables always in the menu.

**Defaults (approved as drafted):**
- **Floor plan grid:**
  - each area is a grid of **24 × 16** cells;
  - a table is a rectangle or a circle, **1–6 cells** wide and high, and new tables start at 2 × 2;
  - the plan is edited on a tablet or a computer; on a phone the plan is view-only.
- **Reservation slot:** a reservation takes its table for **120 minutes**.
- **Reservation hold:**
  - a reservation holds a free table from **60 minutes** before its time; the 60 is a branch setting, `reservation_hold_minutes`;
  - the hold ends when the slot ends, so a forgotten reservation never blocks a table for good;
  - while a table is held, nobody can open a bill on it until the reservation is **seated**, **cancelled** or marked **no-show**.
- **Status board access:** it needs `report.view`, the managers' permission. Reservations need `sale.create`, so cashiers and waiters can take bookings.

**Not in this feature:**
- online or self-service booking;
- deposits;
- SMS or email reminders;
- a waitlist;
- reservations not tied to a table;
- several floors drawn as one plan (an **area** is one plan);
- rotated tables and decorative shapes (walls, bar counter).

**Rounds:**
- **TM1:** Tables always in the menu, the floor plan and the status board.
- **TM2:** reservations.

### A. Permissions, menu and settings
- **The Tables page is always in the sidebar.**
  - It no longer depends on dine-in being on.
  - It shows for `settings.manage` **or** `report.view`.
- **The page has up to four tabs**, each shown by permission:

| Tab | Needs | While dine-in is off |
|---|---|---|
| **Board** (§D) | `report.view` | `Turn on dine-in in Settings to use the board.` |
| **Reservations** (§E, TM2) | `sale.create` | `Turn on dine-in in Settings to take reservations.` |
| **Floor plan** (§B) | `settings.manage` | works |
| **List** (today's admin screen, §B of v1.26) | `settings.manage` | works |

- **`GET /tables` permission:** it now needs `sale.create` **or** `report.view`, so the Board can read it.
- **`BranchSettings` gains** one field (TM2), in `GET/PATCH /admin/settings` and in `GET /print-config`'s `settings`:

| Field | Type | Default | PATCH rule |
|---|---|---|---|
| `reservation_hold_minutes` | integer | `60` | `integer`, `min:0`, `max:240` |

- **Turning dine-in off** while reservations are booked is allowed. The reservations stay booked but do nothing until dine-in is on again. Turning it off while bills are open is still blocked (`409`, v1.26 §A).

### B. Floor plan (TM1; `settings.manage`)
**`DiningTable` gains** five fields, after `seats`:
```json
{ "id": 5, "name": "5", "area": "Patio", "seats": 4,
  "pos_x": 3, "pos_y": 2, "width": 2, "height": 2, "shape": "rect",
  "sort_order": 0, "is_active": true, "updated_at": "…" }
```
- `pos_x` and `pos_y` are both `null` when the table isn't placed on the plan yet. New tables and existing tables start unplaced.
- `width` and `height` are `1–6` (default `2`). `shape` is `rect` or `round` (default `rect`).
- `POST` and `PATCH /admin/tables` don't take these fields; only the layout endpoint below sets them.
- **Changing a table's `area`** (PATCH) unplaces it: `pos_x` and `pos_y` become `null`.

**`PUT /api/v1/admin/tables/layout`** (`v1.admin.tables.layout`) saves a whole area's plan in one go.
- **Body:** `area` (`present`, `nullable`, `string`, `max:30`) and `tables` (`array`, `1–100`). Each entry has:
  - `id`: required, a non-deleted table of the branch **in that area**; otherwise `422` on `tables.{i}.id`: `Table 5 isn't in this area.`;
  - `pos_x` and `pos_y`: both `null`, or both integers ≥ 0; otherwise `422` on `tables.{i}.pos_x`: `Place the table or leave it off the plan.`;
  - `width` and `height`: `1–6`;
  - `shape`: `rect` or `round`.
- **Checks** run on the area's final layout, so tables not in the body count where they already are:
  - inside the grid: `pos_x + width ≤ 24` and `pos_y + height ≤ 16`; otherwise `422` on `tables.{i}.pos_x`: `Table 5 doesn't fit on the plan.`;
  - no two placed tables of the area overlap, judged by their rectangles (a circle counts as its square); otherwise `422` on `tables.{i}.pos_x`: `Table 5 overlaps Table 6.`
- **The save is atomic:** all of it is saved or none of it.
- **Response:** 200 `{data: DiningTable[]}`, the area's tables in the admin order.
- **Audit:** one `table.layout_updated` entry with `{area, count}`.

**`GET /tables` items gain** the same five fields after `seats` (TM1).

### C. Tables view on Sell (TM1)
- **Each area** shows its **floor plan** when at least one of its tables is placed, and the grid of v1.26 otherwise.
  - A **Floor | Grid** switch changes the view; each device remembers the choice.
  - Unplaced tables appear as cards below the plan.
- **The plan scales** to the width of the screen. Tables are drawn at their position and size, with the same colours and contents as today's cards: name, status, guests, the remaining amount and the elapsed time.
- **A shared status helper in `@pos/core`** decides a table's status:
  - `occupied`: the table has a tab;
  - `reserved` (TM2): no tab, and `reservation.is_held`;
  - `free`: neither.
  - An occupied table with a held reservation also shows a `Reserved 7:00 PM` badge.

### D. Status board (TM1; `report.view`)
**`GET /api/v1/tables/summary`** (`v1.tables.summary`; `report.view`; `409` while dine-in is off):
```json
{ "data": {
  "tables_total": 18, "tables_occupied": 7, "tables_reserved": 2, "tables_free": 9,
  "guests_seated": 23,
  "pending_bills": 7, "pending_cents": 1245000,
  "oldest_open": { "tab_ulid": "01K…", "table_name": "5", "opened_at": "…" },
  "reservations_today": { "booked": 6, "seated": 3, "no_show": 1, "cancelled": 0 },
  "generated_at": "…" } }
```
- It counts **active** tables only.
- `tables_reserved` counts free tables held by a reservation. It is `0` before TM2, and so is every `reservations_today` count.
- `pending_cents` is Σ `remaining_cents` over the open tabs: before discounts and service charge, the same as each card.
- `oldest_open` is `null` when no bill is open.
- `reservations_today` counts by the reservation's business day.

**`TabSummary`** (on `GET /tables`) **gains `last_round_at`**: the time of the newest round sent, or `null` before the first one.

**Board screen** (polls every 15 seconds, like the Tables view):
- **Stat cards:**
  - Occupied `7 / 18`;
  - Guests seated;
  - **Pending payments** `₱12,450.00 · 7 bills`, with the note `Before discounts and service charge`;
  - Oldest bill, as `Table 5 · 2 h 10 min`.
- **A table list** with these columns:
  - table and area;
  - status;
  - guests;
  - opened by;
  - time open, amber after 90 minutes as on the cards;
  - time since the last round;
  - unpaid amount.

  It sorts by any column, starts sorted by **time open, oldest first**, and has an **Unpaid only** filter. With `sale.create`, tapping a row opens the bill.
- **Upcoming reservations** (TM2): today's booked reservations by time.
- **Phones:** the stat cards stack, and the list becomes rows.

### E. Reservations (TM2; `sale.create`; online only)
Every endpoint returns `409 "Dine-in tables are turned off in Settings."` while dine-in is off. Every mutation takes `Idempotency-Key`, as tabs do.

**Shared object `Reservation`:**
```json
{
  "ulid": "01K…", "status": "booked",
  "table": { "id": 5, "name": "5", "area": "Patio" },
  "guest_name": "Santos", "phone": "0917 123 4567", "party_size": 4,
  "reserved_for": "…", "business_date": "2026-10-26", "notes": null,
  "is_held": false, "is_late": false,
  "tab_ulid": null,
  "created_by": { "id": 3, "name": "Cara" }, "updated_at": "…"
}
```
- `status` is `booked`, `seated`, `cancelled` or `no_show`.
- `is_held`: `status = booked` and `reserved_for − reservation_hold_minutes ≤ now < reserved_for + 120 min`.
- `is_late`: `status = booked` and `now > reserved_for + 15 min`. It is for display only.

| # | Method | URI | Route name |
|---|---|---|---|
| 1 | GET | `/api/v1/reservations` | `v1.reservations.index` |
| 2 | POST | `/api/v1/reservations` | `v1.reservations.store` |
| 3 | PATCH | `/api/v1/reservations/{ulid}` | `v1.reservations.update` |
| 4 | POST | `/api/v1/reservations/{ulid}/cancel` | `v1.reservations.cancel` |
| 5 | POST | `/api/v1/reservations/{ulid}/no-show` | `v1.reservations.no_show` |

A reservation in another branch, or one that doesn't exist, returns `404`.

**1. List:** needs `sale.create` **or** `report.view` (read-only, for the Board; Q-051). Every other endpoint here needs `sale.create`.
- **Query:**
  - `date`: a business day, default today;
  - `status`: optional, one of the four;
  - `table_id`: optional.
- **Response:** the cursor envelope, ordered by `reserved_for`, then `id` (`per_page` 1–100, default 100).

**2. Create:** body `ulid` (= the key), plus:
- `table_id`: required, an active table of the branch;
- `guest_name`: required, `max:60`, trimmed;
- `phone`: `nullable`, `max:20`, `regex:/^[0-9+ ()-]+$/`;
- `party_size`: required, `1–99`. It may exceed the table's `seats`; the client only warns;
- `reserved_for`: required, ISO date-time. It must be **no earlier than 15 minutes ago** and **at most 90 days ahead**; otherwise `422` on `reserved_for`: `Pick a time from now up to 90 days ahead.`;
- `notes`: `nullable`, `max:255`.

**Clash rule:** another `booked` reservation on the same table less than 120 minutes before or after this one returns `422` on `reserved_for`: `Table 5 is already reserved at 7:00 PM.` A row lock on the table stops two devices booking it at once.

**Response:** 201 `{data: Reservation}`. **Audit:** `reservation.created`.

**3. Update:** the same fields, all partial, with the same rules and clash check. It only works while `booked`; otherwise `409 "This reservation is no longer booked."`. Response: 200 `{data: Reservation}` (Q-052). Audit: `reservation.updated` (`{from, to}`).

**4. Cancel:** body `reason` (`nullable`, `max:255`). It only works while `booked`, and gives the same `409` otherwise. Response: 200 `{data: Reservation}`. Audit: `reservation.cancelled`.

**5. No-show:** only while `booked`, and only once `now ≥ reserved_for`; earlier returns `409 "It isn't 7:00 PM yet."`. Response: 200 `{data: Reservation}`. Audit: `reservation.no_show`.

**Seating** happens through the existing **`POST /tabs`** (v1.26 §D.1), which gains **`reservation_ulid`** (`nullable`):
- The reservation must be `booked`, or the response is `409 "This reservation is no longer booked."`.
- `table_id` must be the reservation's table; otherwise `422` on `table_id`: `This reservation is for Table 5.`
- `guests` defaults to `party_size`.
- **On success:** the reservation becomes `seated` and stores `tab_id`. Audit: `reservation.seated`.
- The tab opens in the same transaction, under the same table lock.

**The hold, enforced by the server:**
- `POST /tabs` **without** `reservation_ulid` on a table held by another booked reservation returns `409 "Table 5 is reserved for Santos at 7:00 PM."`
- `POST /tabs/{ulid}/transfer` (v1.26 §D.8) onto a held table returns the same `409`.
- Merging is unaffected.

**Tables:**
- Deleting or deactivating a table that has future `booked` reservations returns `409 "Table 5 has 2 upcoming reservations. Move or cancel them first."`
- **`GET /tables` items gain `reservation`:** the table's earliest `booked` reservation whose slot hasn't ended and whose time is within the next 24 hours, as `{ ulid, guest_name, party_size, reserved_for, is_held, is_late }`, or `null`.

### F. Clients (tablet and web; the same behaviour)
- **Tables page** (§A): the tabs **Board · Reservations · Floor plan · List**, shown by permission. It opens on the first tab the user can see.
- **Floor plan editor** (TM1):
  - an area picker, the grid canvas, and an **Unplaced** tray;
  - drag a table onto the grid or across it. It snaps to cells, and the client runs the same fit and overlap check (shared helper in `@pos/core`) before saving;
  - selecting a table shows width, height and shape, plus **Remove from plan**;
  - **Save** and **Discard**; leaving the page with unsaved changes asks first;
  - on a phone, the plan is view-only, with the note `Edit the floor plan on a tablet or computer.`
- **Sell → Tables** (§C) gets the floor plan and, in TM2:
  - a **Reservations** button that opens today's list;
  - tapping a **reserved** table opens a sheet: `Reserved for Santos · 4 guests · 7:00 PM`, with **Seat now** (opens the bill with `reservation_ulid`), **Cancel** and **No-show**.
- **Reservations tab** (TM2):
  - a date picker (the existing date field), with the day's reservations by time, showing status chips and **Late** in amber;
  - **New reservation** asks for the table, guest name, phone, party size, date, time and notes;
    - the table picker marks tables that clash;
    - the form warns, without blocking, when the party is larger than the table's seats;
  - row actions: **Edit**, **Seat now** (today only), **Cancel**, **No-show**.
- **Board** (TM1): §D.
- **Settings → Dine-in** (TM2): a **Hold reserved tables from** field in minutes, with the help text `How long before the booking time the table is kept free.`
- **Offline:** Board, Reservations and Sell → Tables show `Tables need a connection.` The Floor plan and List tabs need a connection to save, as admin screens do today.
- **Errors:** `401` signs out. `409` shows in a dialog and reloads. `422` shows on its field; layout errors also highlight the table on the plan.
- **No new packages:**
  - the tablet uses the gesture-handler, reanimated and SVG packages already installed, so no new Dev Client build is needed;
  - the web uses pointer events.

### G. Data model (backend)
- **`dining_tables`** gains:
  - `pos_x` and `pos_y` (tinyint unsigned, null);
  - `width` and `height` (tinyint unsigned, default 2);
  - `shape` (string 10, default `rect`).
- **`table_reservations`** (TM2):
  - `id`, `ulid` (unique), `branch_id`, `table_id`;
  - `guest_name`, `phone`, `party_size`, `reserved_for`, `business_date`, `notes`;
  - `status`, `tab_id` (null), `cancel_reason`;
  - `created_by`, `updated_by`, `status_changed_by`, `status_changed_at`, timestamps.
  - Indexes: `(branch_id, business_date, reserved_for)` and `(table_id, status, reserved_for)`.
- **Settings key:** `reservation_hold_minutes`.

### H. Build
- **packages/pos-core** (owned by **frontend-agent**):
  - contract types (the main session writes them at approval);
  - the floor plan grid constants and the fit and overlap check;
  - the table status helper (§C) and the reservation clash, hold and late helpers.
- **backend-agent:**
  - the migrations;
  - the layout endpoint, the summary endpoint and `last_round_at`;
  - the reservations endpoints, policies and actions;
  - the hold checks in open and transfer;
  - the table delete and deactivate guard;
  - the setting.
  - **Tests:**
    - layout: fit, overlap with tables not in the body, atomicity, and an area change that unplaces;
    - summary: the figures, and `409` while off;
    - permissions: `report.view` vs `sale.create`;
    - reservations: CRUD, the clash in both directions, a concurrent booking, the 90-day and past limits, status transitions, and the no-show time rule;
    - seating: through `POST /tabs` with the table mismatch and the guests default;
    - the hold: it blocks open and transfer, and the hold window and its end are honoured;
    - the table delete guard;
    - branch isolation.
- **frontend-agent** (`mobile/`) and **web-agent** (`web/`): §F.

---


## Open Questions

Agents **append only**. Use the next free number. Only the main session changes a status to `RESOLVED` and fills in the resolution.

Format:
```
### Q-001 [FRONTEND→BACKEND] <short title> — OPEN
- Raised by: frontend-agent · Feature: <feature> · Endpoint: <METHOD /api/v1/...>
- Problem: <what is missing or wrong>
- Proposal: <exact change requested: field name, type, shape>
- Resolution: <main session fills this in> — RESOLVED (YYYY-MM-DD)
```
Tags: `[FRONTEND→BACKEND]`, `[BACKEND→FRONTEND]`, `[FRONTEND→MAIN]`, `[BACKEND→MAIN]`.

### Q-001 [BACKEND→MAIN] Sync rule 4: which `server_time` caps the restart point in a multi-page run — RESOLVED
- Raised by: backend-agent · Feature: Catalogue Sync (Phase 2) · Endpoint: GET /api/v1/sync/catalogue
- Problem: Rule 4 says the next delta restarts at `min(newest updated_at seen in this run, server_time) − 5 s`. In a one-page run there is only one `server_time`. In a multi-page run, a literal reading uses the last page's `server_time`, and that loses a deletion in a paged **baseline**. Example (limit 1): page 1 at t=0 sends product A. At t=2 A is soft-deleted. At t=10 product B is edited, and page 2 (t=10) sends B, so the newest seen is t=10. The literal restart is min(10, 10) − 5 = t=5. A's tombstone (`updated_at` t=2) comes before that, and a baseline never sends tombstones (rule 1), so the device keeps A until its next baseline. Delta runs don't have this problem, because they include soft-deleted rows and pick up rows changed mid-run on later pages.
- Proposal: Use the `server_time` of the run's **first** page (the run start). The rule becomes `min(newest updated_at seen in this run, run start) − 5 s`, still never before the run's own restart point. This value is always ≤ the literal one, so the only effect is that a few extra rows may be re-sent, which rule 4 already says is harmless. Nothing in the response shape changes (the cursor is opaque). **Implemented provisionally this way** (`App\Actions\Sync\PullCatalogueAction`, covered by the test "does not miss a row deleted during a paged baseline"). If you prefer the literal last-page reading, it is a one-line change.
- Resolution: Accepted as implemented. The restart point is capped by the run's **start** (the first page's `server_time`), not the last page's. This fixes the wording of rule 4 in line with its intent ("Nothing is missed"). The response shape doesn't change and the frontend isn't affected, because the cursor is opaque. Rule 4's text is updated. — RESOLVED (2026-09-24)

### Q-002 [FRONTEND→MAIN] Image prefetch "keyed by `image_path`": expo-image can't set a cache key on prefetch — RESOLVED
- Raised by: frontend-agent · Feature: Catalogue Sync (Phase 2) · Endpoint: GET /api/v1/sync/catalogue (Device rules → Images)
- Problem: The Device rules say to prefetch every visible `image_url` into the expo-image disk cache "keyed by `image_path`". In SDK 57, `Image.prefetch(urls, cachePolicy | { cachePolicy, headers })` has **no cache-key option**: it always keys by the URL. Only `<Image source={{ uri, cacheKey }}>` takes a `cacheKey`. If tiles used `cacheKey: image_path`, they would miss the URL-keyed prefetch, and the offline tiles would show placeholders. Keying by URL behaves the same today, because `image_url` contains `image_path` and a change of origin triggers a baseline anyway. It breaks only if `image_url` can change while `image_path` stays the same, for example signed or expiring S3 URLs in production (Phase 1a: "S3-compatible in prod").
- Proposal: Accept keying by URL for Phase 2 and change the rule to "prefetched by `image_url`; `image_path` changes whenever the image changes". Also confirm that production `image_url`s are **stable** (not presigned or expiring). If they will be presigned, a follow-up is needed: warm the cache by rendering the image with `cacheKey: image_path` instead of calling `Image.prefetch`. **Implemented provisionally:** prefetch by URL (`cachePolicy: "disk"`), and tiles load by URL with `cachePolicy: "memory-disk"`. The spot is marked `TODO(Q-002)` in `mobile/src/sync/catalogueSync.ts`.
- Resolution: Accepted as implemented. Prefetch by `image_url` into the disk cache, and tiles load by URL. The device rule's wording is updated. Image URLs are expected to be **stable, public** URLs in every environment (the file uploads convention already says `image_url` is "an absolute URL the app can load directly"). Presigned or expiring URLs are out of scope. If production storage ever needs them, that change must also switch the cache to `cacheKey: image_path`. — RESOLVED (2026-09-24)

### Q-003 [FRONTEND→BACKEND] The app can't read the VAT rate that sale pricing uses — RESOLVED
- Raised by: frontend-agent · Feature: Core Sale (Phase 3) · Endpoint: POST /api/v1/orders (Sale pricing, step 8)
- Problem: Step 8 takes the rate from `config('pos.vat_rate_bps')` (1200). The app runs the same algorithm to show VATable sales, VAT and VAT-exempt sales at checkout, but no endpoint sends the rate, so the app hardcodes 1200 (`VAT_RATE_BPS` in `mobile/src/sale/pricing.ts`). If the config ever changes, checkout would show a VAT split that differs from the server's. The receipt (`Order`) would still be right, and the checksum isn't affected, because `total_cents` doesn't depend on the rate.
- Proposal: Either confirm that the rate is fixed at 1200 for v1 (the app keeps the constant), or add `vat_rate_bps` (integer, basis points, not nullable) to `AuthUser.branch`, so it arrives with login, `me` and the PIN switch, and the app prices with it. **Implemented provisionally:** the constant 1200, marked `TODO(Q-003)` in `mobile/src/sale/pricing.ts`.
- Resolution: Confirmed fixed. The VAT rate is **1200 bps (12%) for v1**: it is the statutory Philippine rate, and the server holds it as a fixed config value (`pos.vat_rate_bps`, not an env value). The app keeps its constant, and no API change is needed. If the rate ever becomes configurable, that change must add `vat_rate_bps` to `AuthUser.branch` in the same contract revision. As the question notes, the checksum doesn't depend on the rate. — RESOLVED (2026-09-25)

### Q-004 [FRONTEND→MAIN] POST /orders: what the app does on "This Idempotency-Key was already used for a different request." — RESOLVED
- Raised by: frontend-agent · Feature: Core Sale (Phase 3) · Endpoint: POST /api/v1/orders (Global Conventions → Idempotent requests)
- Problem: This `409` means an earlier request with the sale's ULID **succeeded** with a different body, so the sale already exists. After a timeout the app locks the cart and the payments, so a retry normally resends the identical body. The 409 can still happen in a rare case: checkout is reopened after a timeout, and a *different* manager approves the discount (`discount_authorization.user_id` is part of the compared body). The contract defines only the in-flight 409 ("retry shortly"). Today the app shows the server's message and the cart keeps its ULID. If the cashier then clears the cart and rings the sale up again, it is recorded twice.
- Proposal: On this 409, the app calls `GET /api/v1/orders/{ulid}` with the pending ULID. On **200**, the sale went through: the app shows the success screen from that `Order`, notes that an earlier attempt completed it, and clears the cart. On **404** (for example, not visible to this user), it keeps showing the message. No API change is needed; the app tells the two 409s apart by their contract messages. **Implemented provisionally:** the message is shown and the cart keeps its ULID, marked `TODO(Q-004)` in `mobile/src/sale/orderErrors.ts`.
- Resolution: Accepted, with the 404 wording defined. On this `409` from `POST /orders`, the app calls `GET /api/v1/orders/{ulid}` with the pending ULID.
  - **200:** show the success screen from that `Order` (its own totals, tendered and change), with the note `An earlier attempt already completed this sale.`, then clear the cart and the ULID.
  - **404/403** (for example, rung up by another cashier before a PIN switch): show `This sale was already recorded. Check Orders before charging again.` The cart stays locked with its ULID, and Clear is still allowed with its warning.
  - **Network error:** keep the message and offer Retry, which repeats the lookup.
  The rule is added to the Phase 3 *App (frontend)* list. There is no API change. — RESOLVED (2026-09-25)

### Q-005 [BACKEND→MAIN] Default kitchen printer: when exactly does the auto-default apply? — RESOLVED
- Raised by: backend-agent · Feature: Printing (Phase 4) · Endpoint: POST /api/v1/admin/printers, PATCH /api/v1/admin/printers/{id}
- Problem: The rule says "When the branch has no default, the first **enabled** kitchen or bar printer that is created or enabled becomes the default automatically." Two cases are not covered:
  1. **An explicit `is_default_kitchen: false`** in the same request (for example, the app's form always sends the switch's value). Does the auto-default still apply, overriding the `false`? If it doesn't, an app that always sends the field never triggers the rule.
  2. **A role change** from `cashier` to `kitchen`/`bar` on an enabled printer, while the branch has no default. The printer becomes eligible, but it was not "created or enabled".
- Proposal: Keep the literal reading, which is what is **implemented provisionally** (`App\Actions\Printing\CreatePrinterAction`, `UpdatePrinterAction`): (1) the auto-default applies on create, and on an `is_enabled` change from `false` to `true`, **even when the request sends `is_default_kitchen: false`**; the response shows the printer as the default, so the app can show it. (2) A role change alone never triggers it. Nothing else reassigns the default: disabling, deleting, or changing the default printer to `cashier` leaves the branch without one until an admin picks one. If you prefer that an explicit `false` wins, or that a role change also triggers the rule, each is a one-line change. No response shape changes either way.
- Resolution: The literal reading is accepted, **extended to role changes**.
  - **Trigger:** the auto-default applies whenever a printer **becomes an enabled kitchen or bar printer** (created, enabled, or its role changed from `cashier`) while the branch has no default. It applies even if the request sends `is_default_kitchen: false`, because the app's form always sends the switch's value.
  - **Nothing reassigns** the default when the default printer is disabled, deleted, or changed to `cashier`. The branch then has no default until an admin picks one, and the app shows its "no default kitchen printer" warning.
  - **App:** the response shows the resulting flag, so the app reflects it.
  - There is no shape change. — RESOLVED (2026-09-26)

### Q-006 [FRONTEND→MAIN] Kitchen ticket: in what order are the lines printed? — RESOLVED
- Raised by: frontend-agent · Feature: Printing (Phase 4) · Endpoint: none (Device rules → Kitchen ticket layout)
- Problem: The kitchen ticket example lists `2 x Rice Cake` before `1 x Hot Dog`, but in worked example B (and in `Order.items`) Hot Dog is line 1 and Rice Cake is line 2. The rules say only that lines with the same `(product_id, notes)` are merged. The example could mean the order of sale was changed on purpose (for example, the largest quantity first, or lines without notes first), or it could be illustrative only.
- Proposal: Print the merged lines in the **order of sale**, each merged line at the position of its first occurrence (the cashier rang the items in that order, and it keeps a reprint identical to the first print). If another order is wanted, say which (for example, `qty` descending, then order of sale). **Implemented provisionally:** order of sale, marked `TODO(Q-006)` in `mobile/src/printing/documents/kitchenTicket.ts` (`mergeTicketLines`). A different order is a one-line sort there. No API change.
- Resolution: Lines print in **sale order** (the order of `items[]`), with merged lines kept at the position of their first occurrence. The layout example is illustrative only. Accepted as implemented. — RESOLVED (2026-09-26)

### Q-007 [FRONTEND→MAIN] Reprint → Kitchen tickets while `print_kitchen_tickets` is off — RESOLVED
- Raised by: frontend-agent · Feature: Printing (Phase 4) · Endpoint: none (Device rules → Routing, Screens → Order detail)
- Problem: Routing says "When `print_kitchen_tickets` is off, no tickets print." Order detail offers **Reprint → Kitchen tickets (all stations)**. It isn't stated whether an explicit reprint follows the setting (nothing prints) or overrides it (a manager asked for the tickets on purpose, for example to hand the kitchen a paper copy once).
- Proposal: The reprint **follows the setting**: nothing is queued and the screen says `Kitchen tickets are turned off in Settings.` This keeps one routing rule for every print. If an explicit reprint should print anyway, the change is to skip that check for reprints only. **Implemented provisionally:** follows the setting, marked `TODO(Q-007)` in `mobile/src/printing/printActions.ts` (`reprintOrder`). No API change.
- Resolution: `print_kitchen_tickets` governs **automatic** printing only. A manual **Reprint → Kitchen tickets** is an explicit request and prints regardless of the setting, using the normal routing. The app changes accordingly. — RESOLVED (2026-09-26)

### Q-008 [BACKEND→MAIN] POST /sync/orders: ingest cases that neither the reject list nor the accept rules cover — RESOLVED
- Raised by: backend-agent · Feature: Offline Sales (Phase 5) · Endpoint: POST /api/v1/sync/orders
- Problem: The rules say an offline order is rejected **only** for the five listed reasons and is never rejected for price, stock, checksum or payment. Some inputs can't follow that literally:
  1. **The sale can't be priced:** a line or order discount above its base, or `subtotal_cents` above ₱10,000,000. `SaleCalculator` has no result to store. (A correct app never produces this, since it runs the same algorithm.)
  2. **GCash above the server's `total_cents`:** Phase 3 rejects it. The rule "payments are stored with the Phase 3 rules" can't take the change out of cash when GCash alone exceeds the total. (Reachable only with an app bug, or together with `total_mismatch`.)
  3. **The `ulid` belongs to another branch's order:** it isn't a duplicate "in the branch", and it can't be stored (UNIQUE `ulid`).
  4. **An unexpected server error while storing one order** (for example a deadlock that survives the retries): the contract says one order's failure doesn't affect the rest, but `rejected` means "can never be stored".
  5. **`customer_id` of a soft-deleted customer:** the reject reason says "doesn't exist", while `POST /orders` requires a non-deleted customer.
  6. **Future `placed_at` within 5 minutes:** "a future time is clamped to now" vs "`clock_skew`: more than 5 minutes in the future".
- Proposal (**implemented provisionally** in `App\Actions\Sync\IngestOfflineOrderAction`):
  1. `rejected`, with the Phase 3 message (`The discount can't be more than ₱72.00.` / `This sale is too large.`).
  2. `accepted`: the payments are stored **as tendered with change 0** (as in the short case). No new review reason is added; `total_mismatch` flags the only realistic path.
  3. `rejected`: `This sale was already recorded in another branch.`
  4. That order alone gets `rejected`: `The server couldn't record this sale. Try again.` The error is logged and the rest of the batch continues. (The alternative, a `500` for the whole request, would let one poison order block the FIFO outbox forever.) The app's **Retry** re-queues it.
  5. `accepted`: a soft-deleted customer still exists (like a soft-deleted product). Only an id that never existed is rejected: `Customer 12 doesn't exist.`
  6. Any future `placed_at` is clamped to the server's now; `clock_skew` is added only when it was more than 5 minutes ahead.
  No response shape changes either way.
- Resolution: All six provisional choices are accepted: (1) an unpriceable order is rejected with the Phase 3 message; (2) GCash above the total is accepted, payments stored as tendered with change 0; (3) a ULID owned by another branch is rejected; (4) an unexpected server error rejects that order only, so one bad order never blocks the queue, and the device shows it under Needs attention with Retry; (5) a soft-deleted customer is accepted; (6) a future `placed_at` is always clamped, flagged `clock_skew` only above 5 minutes. — RESOLVED (2026-09-26)

### Q-009 [BACKEND→MAIN] Dashboard insight `orders_need_review`: message text and the singular title — RESOLVED
- Raised by: backend-agent · Feature: Offline Sales (Phase 5) · Endpoint: GET /api/v1/dashboard
- Problem: The insight object needs a `message` (one sentence of advice), and the contract gives none for `orders_need_review`. The title is given as `N offline sales need review`, while every other insight uses the singular for 1 (`1 product is unavailable`).
- Proposal (**implemented provisionally** in `App\Actions\Dashboard\BuildInsights`): `message`: `Check these sales and mark them reviewed.`; `title`: `1 offline sale needs review` / `N offline sales need review`. No shape change.
- Resolution: Accepted as implemented: message `Check these sales and mark them reviewed.`, with a singular title for 1. — RESOLVED (2026-09-26)

### Q-010 [FRONTEND→MAIN] Offline receipt: `QUEUE #5` or `QUEUE T01-5`? — RESOLVED
- Raised by: frontend-agent · Feature: Offline Sales (Phase 5) · Endpoint: none (Device rules → Printing offline)
- Problem: For a local order, the kitchen ticket's big number is `T01-5` "in place of `#queue`", and "everything else is as in Phase 4". Read literally, the customer's receipt still prints `QUEUE #5` (the local `queue_no` is the daily sequence). With two tablets offline, both can hand out `QUEUE #5` while the kitchen calls `T01-5` and `T02-5`, so the number on the receipt doesn't match the number the kitchen calls.
- Proposal: on a local order (`invoice_no: null`), the receipt's queue line prints `QUEUE T01-5`, matching the kitchen ticket. Online receipts are unchanged. **Implemented provisionally** as the literal reading (`QUEUE #5`), marked `TODO(Q-010)` in `mobile/src/printing/documents/receipt.ts`; the change is one line. The success screen and Orders already show `T01-5` for local orders. No API change.
- Resolution: Print `QUEUE T01-5` on the offline receipt, the same number the kitchen ticket shows, so two offline tablets never print the same queue number. The app changes accordingly. — RESOLVED (2026-09-26)

### Q-011 [FRONTEND→MAIN] Timeout fallback when a manager's approval was part of the attempt — RESOLVED
- Raised by: frontend-agent · Feature: Offline Sales (Phase 5) · Endpoint: POST /api/v1/orders → POST /api/v1/sync/orders (Device rules → When a sale goes offline)
- Problem: A `POST /orders` that times out falls back to an offline save with the same ULID. When that attempt carried `discount_authorization` (a manager approved by PIN), the offline copy can't carry the approval (`OfflineOrder` has no `discount_authorization`, and "offline, only discounts within the cashier's own limit are allowed"). If it is saved offline and the online attempt never committed, the server accepts it flagged `discount_over_limit` and records no approver, even though a manager did approve it at the counter.
- Proposal: no offline fallback for such a sale. It keeps the Phase 3 handling: the cart and payments stay locked and **Retry** resends the same body with the same ULID once the server is reachable. The banner adds `Needs a manager approval — connect to the internet.` If you prefer the fallback anyway (accept and flag), it is a one-condition change. **Implemented provisionally** as proposed, marked `TODO(Q-011)` in `mobile/src/hooks/sell/useCheckout.ts`. No API change.
- Resolution: Accepted as implemented: no offline fallback when the attempt carried a manager approval. The user decided offline sales allow only discounts within the cashier's own limit, and an unverified approval must not reach the server as an offline sale. The cart keeps the Phase 3 locked Retry, with the explanation line. — RESOLVED (2026-09-26)

### Q-012 [BACKEND→MAIN] Shift endpoints: cases the rules don't cover — RESOLVED
- Raised by: backend-agent · Feature: Shifts & Reporting (Phase 6) · Endpoint: POST /api/v1/shifts, POST /api/v1/shifts/{ulid}/cash-movements, POST /api/v1/shifts/{ulid}/close, GET /api/v1/shifts, GET /api/v1/shifts/{ulid}
- Problem: The rules leave these cases open:
  1. **A close for an auto-closed shift** (its close was held in *Needs attention* and retried after the next shift opened). "The first close wins" reads as: the auto-close was the first close, so the counted cash is never recorded.
  2. **`variance_cents` of an auto-closed shift**, which has no counted cash.
  3. **Two open shifts where the one already open was opened *later*** than the new one's `opened_at`. Closing it at the new `opened_at` would put its `closed_at` before its `opened_at`.
  4. **The device check on the reads.** "The token must be bound to a device" is stated for the whole table, but the reasons given are about writes.
  5. **The 422 messages** for `opened_by` / `closed_by` / `user_id` that aren't active users of the branch, and whether a **repeat** is still checked (the user may have been deactivated since the first request).
  6. **Timestamps from the tablet** (`opened_at`, `occurred_at`, `closed_at`): clamped like `placed_at`, or stored as sent?
  7. **ULID clashes:** `POST /shifts` with the ULID of another tablet's shift; a cash-movement ULID already used for another shift; a shift ULID the branch doesn't know.
  8. **What the report counts** after a close: cash movements received after it, and offline orders synced after it.
  9. **The `business_date` filter** of `GET /shifts`.
  10. **Audit of an auto-close.**
- Proposal (**implemented provisionally** in `App\Actions\Shifts\*`, `App\Http\Requests\Shifts\*`, `App\Policies\ShiftPolicy`):
  1. Literal: an auto-close counts as the first close, and a later close returns the stored shift with `200` (no count recorded). The alternative, recording the count, time and note on an auto-closed shift that has no count yet (keeping `auto_closed`), is a small change.
  2. `variance_cents` is `null` whenever `counted_cash_cents` is `null` (open, or auto-closed).
  3. Of the device's open shifts, ordered by `opened_at`, every one but the newest is auto-closed at the next one's `opened_at`, so `closed_at` never precedes `opened_at`. When the new shift is the older one, it is created already closed with `auto_closed` (still `201`).
  4. Only the three writes need a device (`409`). `GET /shifts` needs `report.zread`; `GET /shifts/{ulid}` needs `report.zread`, or a token bound to the shift's device (otherwise `403`). Another branch's shift, or an unknown one, is `404`.
  5. Laravel's default message on the field (`The selected opened by is invalid.`, `The selected closed by is invalid.`, `The selected user id is invalid.`). A repeat (known shift ULID, known movement ULID, or an already closed shift) skips the user check and gets the stored `200`.
  6. Stored as sent (UTC, to the second), with no clamping and no ordering check; nothing is rejected for a time.
  7. `POST /shifts` with the ULID of a shift of another tablet or branch → `409 "This shift belongs to another tablet."`. A cash-movement ULID already used for another shift → `422` on `ulid` (`The ulid has already been taken.`). A shift the caller's branch doesn't know → `404` on the cash, close and show endpoints.
  8. Every cash movement of the shift counts (including those flagged `movement_after_close`), and so does every `completed` order carrying its `shift_ulid` (including offline orders flagged `shift_closed`). The report is live, so a closed shift's report can still change. `needs_review_count` is the current count of those orders with `needs_review = true`.
  9. The business day of `opened_at` (branch timezone and day start).
  10. An auto-close writes its own `shift.closed` entry (`auto_closed: true`, `counted_cash_cents: null`, `variance_cents: null`). The actor of each entry is the user named in the body (`opened_by`, `user_id`, `closed_by`; the new shift's opener for an auto-close).
  No response shape changes either way.
- Resolution: Items 2–10 are accepted as implemented. **Item 1 takes the alternative:** a counted cash figure must never be lost. A close for an auto-closed shift that has no count yet records `counted_cash_cents`, `close_note`, `closed_by` and the body's `closed_at` (when that is not before `opened_at`; otherwise the auto-close time stays). It keeps the `auto_closed` flag, audits a `shift.closed` entry with the count and variance, and returns `200` with the updated shift. `variance_cents` is then computed as for any counted shift. A close for a shift that already has a count still returns the stored shift with `200` and changes nothing (the first count wins). — RESOLVED (2026-09-27)

### Q-013 [BACKEND→MAIN] Sales reports: range limit, `meta`, tie-breaks and the CSV layout — RESOLVED
- Raised by: backend-agent · Feature: Shifts & Reporting (Phase 6) · Endpoint: GET /api/v1/reports/sales, GET /api/v1/reports/sales/export
- Problem: These details aren't defined: how "at most 366 days" is counted and its message; whether `meta` is always present; the order of rows that tie on `net_sales_cents`; and the CSV header names (the row fields end in `_cents`, but the file holds pesos), the empty cells and the `TOTAL` line.
- Proposal (**implemented provisionally** in `App\Http\Requests\Reports\SalesReportRequest`, `App\Actions\Reports\BuildSalesReportAction`, `App\Actions\Reports\SalesReportCsv`):
  1. The range is counted **inclusively**: `2025-09-26` to `2026-09-26` is 366 days and is accepted; one more day returns `422` on `to`: `The range can't be longer than 366 days.` `to` before `from` returns Laravel's `The to field must be a date after or equal to from.`
  2. `meta` is always present: `{ "truncated": false }` or `true`.
  3. Rows that tie on `net_sales_cents` are ordered by `label`, then `key`.
  4. CSV: the header is `key,label,orders_count,qty,gross_sales,discounts,net_sales` (no `_cents`, because the values are pesos). A `null` is an empty cell. The last line is `TOTAL,,<orders_count>,<items_sold>,<gross>,<discounts>,<net>` from `totals`. Lines end with CRLF (RFC 4180). The rows are capped at 500 like the JSON; the file carries no truncation marker.
  No JSON shape changes.
- Resolution: Accepted as implemented (all four items). The app keeps its one-day-stricter range clamp and may drop its defensive `meta` read. — RESOLVED (2026-09-27)

### Q-014 [FRONTEND→MAIN] X-read / Z-read: the printed layout isn't defined — RESOLVED
- Raised by: frontend-agent · Feature: Shifts & Reporting (Phase 6) · Endpoint: none (Device rules → Reports on the tablet)
- Problem: The device rules add the document kinds `x_read` and `z_read` (receipt printer, 32 or 48 columns), but unlike the receipt and the kitchen ticket (Printing → Device rules) there is no layout. The order of the sections, what the header shows, and how the variance is worded are open.
- Proposal: **Implemented provisionally** in `mobile/src/printing/documents/shiftRead.ts` (marked `TODO(Q-014)`), printing only `ShiftReport` fields and the shift's own fields, amounts as `1,250.50`:
  ```
  <branch name, centred, bold>
  X-READ | Z-READ                 (centred, double size)
  SHIFT REPORT
  For internal use. Not a BIR reading.
  *** REPRINT ***                 (Z-read reprints from Shifts only)
  Tablet     T01
  Opened     09/26/2026 8:02 AM   (branch timezone)
  Opened by  Carla Cashier
  Closed     09/26/2026 5:05 PM   (when closed)
  Closed by  Marco Manager        (when closed)
  Printed    09/26/2026 3:00 PM   (X-read only)
  --------------------------------
  SALES: Orders, Items sold, Gross sales, Discounts (negative), Net sales (bold), VATable sales, VAT 12%, VAT-exempt sales
  PAYMENTS: Cash (30) 7,000.00 · GCash (14) 5,250.00   (cash net of change)
  CASH DRAWER: Opening float, Cash sales, Cash in, Cash out (negative), Expected cash (bold), Counted cash (when counted), Variance (Short|Over|Balanced) -50.00 (bold, when not null)
  CASHIERS: Carla Cashier (30) 9,000.00   (by_cashier order)
  Sales to review  N              (only when needs_review_count > 0: server reports)
  Note: <close_note>              (when set)
  ```
  X-reads are never deduplicated (each one is a new snapshot); the first Z-read of a shift is printed once, and later copies come from Shifts → Print, marked as a reprint. No API change. If another layout is wanted, it is a change to that one file.
- Resolution: Accepted as implemented; this is the X-read / Z-read layout. — RESOLVED (2026-09-27)

### Q-015 [FRONTEND→MAIN] The tablet's own X-read / Z-read: which local sales count? — RESOLVED
- Raised by: frontend-agent · Feature: Shifts & Reporting (Phase 6) · Endpoint: none (Device rules → Reports on the tablet)
- Problem: "The X-read and Z-read are computed from local data: the shift's sales and cash movements on this tablet." It isn't said whether an offline sale the server **rejected** (Needs attention, never stored on the server) counts. Its cash is physically in the drawer, but the server's `ShiftReport` will never include it, so the tablet's Z-read and the server's report can differ by that sale until someone resolves it.
- Proposal: **Implemented provisionally** (`mobile/src/shifts/shiftActions.ts` → `localShiftReport`, marked `TODO(Q-015)`): every completed sale stored on the tablet with the shift's ULID counts, whatever its sync state (pending, synced, needs attention). A synced sale counts with the server's `Order` (the server's figures). This keeps the tablet's expected cash equal to what the drawer holds. The alternative, leaving out Needs-attention sales so the Z-read matches the server, is a one-line filter. No API change.
- Resolution: Accepted as implemented. The tablet's X-read and Z-read count every completed sale stored with the shift's ULID, whatever its sync state, because they are there to count the drawer. A Needs-attention sale is resolved through its Retry. — RESOLVED (2026-09-27)

### Q-016 [FRONTEND→BACKEND] Shift writes: confirm there is no `Idempotency-Key` header — RESOLVED
- Raised by: frontend-agent · Feature: Shifts & Reporting (Phase 6) · Endpoint: POST /api/v1/shifts, POST /api/v1/shifts/{ulid}/cash-movements, POST /api/v1/shifts/{ulid}/close
- Problem: The endpoints are "idempotent by the `ulid` in the body or path. A repeat gets the stored result with 200." They are not marked **Idempotent: yes**, which in Global Conventions means an `Idempotency-Key` header that a missing value turns into a `422`. The close body has no `ulid` at all, so the header convention can't apply to it as written.
- Proposal: No header, as for `POST /sync/orders`: the server recognises a repeat by the shift or movement ULID (Q-012 item 5 reads the same way). **Implemented** that way in `mobile/src/services/shifts.ts`. If the server does require the header, every shift event from the tablet would be rejected with `422` and land in Needs attention, so please confirm. No shape change.
- Resolution: Confirmed: the three shift writes take no `Idempotency-Key` header. A repeat is recognised by the shift or movement ULID (the routes don't carry the `idempotent` middleware), as for `POST /sync/orders`. — RESOLVED (2026-09-27)

### Q-017 [FRONTEND→MAIN] Voids & refunds on the tablet: wording and print details the device rules leave open — RESOLVED
- Raised by: frontend-agent · Feature: Voids & Refunds (Phase 7) · Endpoint: none (Device rules → Where the actions are, Void dialog, Refund screen, Printing)
- Problem: The device rules don't define these details:
  1. **Refund without an open shift on this tablet.** "It needs an open shift on this tablet", but there is no message (the offline and unsynced cases have one).
  2. **A lost answer** (network error or timeout) on a void or a refund: "Retry with the same key / `ulid`" has no wording, unlike a sale (`We couldn't confirm the sale. Retry.`).
  3. **Refund reason.** The void has quick picks; the refund only says "Reason: required".
  4. **Void slip:** "`<the lines as on the receipt>`" then `TOTAL VOIDED`. With an order discount, the lines alone don't add up to the total. And "GCash to return (per GCash payment, with its reference)" doesn't say where the reference goes.
  5. **X/Z-read:** "add, after the sales section, `Voids (N)`, `Refunds (N)`, `Net after refunds` (bold)": in the SALES section, or a section of its own?
- Proposal (**implemented provisionally**, each marked `TODO(Q-017)`; no API change):
  1. `Open a shift on the Sell screen to refund this sale.` under a disabled **Refund** (`mobile/src/sale/reversals.ts`).
  2. `We couldn't confirm the void. Retry.` / `We couldn't confirm the refund. Retry.`; the form locks and **Retry** resends the same body with the same key (`mobile/src/sale/reversals.ts`).
  3. A required free-text reason on the refund screen (no quick picks); the void keeps the contract's quick picks, with `Other…` asking for the words.
  4. The void slip prints the receipt's lines, then the `Order discount (…)` row when there is one (so the lines add up to `TOTAL VOIDED`); each GCash payment prints `GCash to return  100.00` with `  Ref 1012345678901` on the line under it (`mobile/src/printing/documents/voidSlip.ts`).
  5. A divider after `VAT-exempt sales`, then `Voids (N)`, `Refunds (N)` and **`Net after refunds`**, with no heading, before PAYMENTS; `Cash refunds` (negative) prints after `Cash out` in CASH DRAWER (`mobile/src/printing/documents/shiftRead.ts`).
- Resolution: All five accepted as implemented. The refund reason stays free text, because refund causes vary more than void causes. — RESOLVED (2026-09-27)

### Q-018 [BACKEND→MAIN] Voids & refunds: cases the check lists don't pin down — RESOLVED
- Raised by: backend-agent · Feature: Voids & Refunds (Phase 7) · Endpoint: POST /api/v1/orders/{ulid}/void, POST /api/v1/orders/{ulid}/refunds
- Problem: The checks are well ordered, but these cases are open:
  1. **Where the device `409` sits** ("The token must be bound to a device") relative to `403`, `404` and `422`.
  2. **Which stock comes back** when a product's `track_stock` changed between the sale and the reversal. "One movement per `track_stock` product" could mean the product's flag now or at sale time.
  3. **A refund to a method the sale never used** (e.g. GCash on a cash-only sale). The per-method rule gives a limit of ₱0.00, but no message is defined for it.
  4. **Two payments of the same method** ("at most one per method") has no message.
  5. **A refund ULID that is already recorded** when the idempotency key is gone (a stale-key takeover), or the ULID of **another order's** refund.
  6. **Visibility:** "visible to the caller, as for `GET /orders/{ulid}`" means that without `report.view` a cashier can void or refund only the sales they rang up. After a PIN switch on the same tablet, the next cashier gets `404` for the previous cashier's sale, even with a manager's PIN in the body.
- Proposal (**implemented provisionally** in `App\Http\Requests\Sales\OrderReversalRequest`, `StoreRefundRequest`, `App\Actions\Sales\VoidOrderAction`, `RefundOrderAction`, `ReturnOrderStock`):
  1. As for the shift writes: `403` → `409 "Register this tablet first."` → `404` → `422` (field rules and `idempotency_key`).
  2. **At sale time:** a reversal returns stock only for the products that have a `sale` movement referencing the order, at the line's `unit_cost_cents`. It never returns stock the sale didn't take, so the ledger always reconciles. A product that started tracking after the sale gets nothing back; one that stopped tracking still gets its units back.
  3. The same rule and message: `422` on `payments.{i}.amount_cents`: `Only ₱0.00 paid by GCash is left to refund.`
  4. As for sales: `422` on the later `payments.{i}.method`: `Only one cash payment is allowed.` / `Only one GCash payment is allowed.`
  5. As for sales: the same order's refund ULID returns `201` with the order as it is, with nothing written again. The ULID of another order's refund returns `409 "This Idempotency-Key was already used for a different request."`
  6. Literal: `404`. If the next cashier on the tablet should be able to reverse any sale of their branch with a manager's PIN, the visibility for these two endpoints would change to "the caller's branch". That is a one-line change in `OrderReversalRequest`, and the app would need the order detail too (today `GET /orders/{ulid}` is also `404` for them).
  No response shape changes either way.
- Resolution: Items 1–5 accepted as implemented. Item 6 stays literal (`404`): a cashier without `report.view` can only open, void or refund the sales they rang up, which matches the Orders list. A sale rung up by someone else is reversed by a manager signed in on the tablet (PIN switch). The visibility is unchanged. — RESOLVED (2026-09-27)

### Q-019 [BACKEND→MAIN] Sales reports with refunds: CSV `TOTAL` quantity, refund-only rows and labels — RESOLVED
- Raised by: backend-agent · Feature: Voids & Refunds (Phase 7) · Endpoint: GET /api/v1/reports/sales, GET /api/v1/reports/sales/export
- Problem:
  1. The CSV's `TOTAL` line "fills" `refunded_qty`, but `totals` has no `refunded_qty` field. It isn't said which figure it shows, or whether it stays empty for groupings whose rows have `null`.
  2. "A product refunded in the range but not sold in it still gets a row" is stated for product (and category) rows only. The cashier rows (by the original cashier) aren't covered.
  3. `refunded_qty` on product and category rows when nothing was refunded: `0` or `null`?
  4. The "latest name snapshot" label of a product or category row: should lines of voided sales count as candidates?
- Proposal (**implemented provisionally** in `App\Actions\Reports\BuildSalesReportAction`, `SalesReportCsv`):
  1. The total units refunded in the range, for every grouping. This mirrors the `TOTAL` line's `qty`, which is `items_sold` whatever the grouping (Q-013). It isn't a JSON field.
  2. Yes: a cashier with refunds of their sales in the range but no sales in it gets a row with sales of 0, as products do.
  3. `0` (a number on product and category rows, `null` elsewhere).
  4. Yes: the label is the snapshot of the group's highest order line id among the range's lines (voided included) and its refunded lines. A group sold only on voided sales and never refunded gets no row.
  No JSON shape changes.
- Resolution: All four accepted as implemented. — RESOLVED (2026-09-27)

### Q-020 [FRONTEND→BACKEND] Inventory product detail: no endpoint reads one `InventoryItem` — RESOLVED
- Raised by: frontend-agent · Feature: Inventory (v1 completion) · Endpoint: GET /api/v1/inventory (Device rules → Product detail)
- Problem: The detail screen (`/inventory/[productId]`) needs the summary card's fields (qty, status, reorder level, stock value, cost), and must refresh them after every write. The only writes that return an `InventoryItem` are `PUT …/reorder-level`. A stock adjustment returns a `StockMovement` (no status or stock value). There is no single-item read, so a deep link, a pull-to-refresh or a refresh after Stock in / Count / Wastage has nothing to call.
- Proposal: Add `GET /api/v1/inventory/{product}` (route `v1.inventory.show`, `InventoryController@show`, the same read permission as the list) → `200 { "data": InventoryItem }`. `404` for a product that doesn't exist or is deleted. For a product that isn't `track_stock`, either `404` or `409 { "message": "This product doesn't track stock." }` (as the reorder-level endpoint does). **Implemented provisionally:** the app walks `GET /api/v1/inventory?per_page=100` (usually one page) until it finds `product_id`, and shows the card the list already loaded while it does. A product that isn't in the list shows only its history. Marked `TODO(Q-020)` in `mobile/src/services/inventory.ts` (`findInventoryItem`) and `mobile/src/hooks/inventory/useInventory.ts`.
- Resolution: Accepted. `GET /api/v1/inventory/{product}` (`v1.inventory.show`, `InventoryController@show`, the list's read permission) returns `200 { "data": InventoryItem }`. A product that doesn't exist or is deleted returns `404`, and one that doesn't track stock returns `409 { "message": "This product doesn't track stock." }`, as the reorder-level endpoint does. Added to the Inventory section. The app switches to it and drops the list walk. — RESOLVED (2026-09-27)

### Q-021 [FRONTEND→BACKEND] Movement history items: can `created_by` and `unit_cost_cents` be `null`? — RESOLVED
- Raised by: frontend-agent · Feature: Inventory (v1 completion) · Endpoint: GET /api/v1/inventory/{product}/movements
- Problem: The item example shows `created_by` as an object and `unit_cost_cents: 1200` on a `receipt`. It doesn't say what these are on other movements: `opening` movements written by a seeder or migration may have no user, and `unit_cost_cents` has no meaning on a sale, count or wastage.
- Proposal: `created_by` is `{ id, name }` or `null` (no user, e.g. seeded `opening` movements). `unit_cost_cents` is an integer on `receipt` movements and `null` on every other type. **Implemented provisionally** that way: the row shows only the time when `created_by` is `null`, and shows `Unit cost ₱12.00` only on a stock in with a non-null cost. Marked `TODO(Q-021)` in `mobile/src/services/types.ts` (`InventoryMovement`).
- Resolution: Accepted, with one correction. `created_by` is `{id, name}` or `null`. `unit_cost_cents` is whatever the movement stored, or `null`. Sale, void, refund and adjustment movements also carry a cost snapshot, so it isn't only on receipts. The app still shows it only on a stock in, as implemented. — RESOLVED (2026-09-27)

### Q-022 [BACKEND→MAIN] Inventory: insight messages, audit wording, report totals when truncated, and type-rule details — RESOLVED
- Raised by: backend-agent · Feature: Inventory (v1 completion) · Endpoint: GET /api/v1/dashboard, GET /api/v1/reports/inventory (+ export), POST /api/v1/admin/products/{id}/stock-adjustments
- Problem: These details aren't defined:
  1. The `message` of the `stock_out` and `stock_low` insights (the table gives only the titles).
  2. The activity summary of `stock.reorder_level_changed` when the level is **cleared** (`null`); the contract only shows `Set reorder level of "Iced Tea" to 10`.
  3. The report's flow totals (`received`, `sold`, `returned`, `wasted`, `adjusted`) are "summed over the rows' products": it isn't said whether that means every product matching the filters, or only the ≤ 500 rows returned when `meta.truncated` is `true`.
  4. `POST …/stock-adjustments` with a `type`: what happens when the quantity field the type doesn't use is also sent (e.g. `counted_qty` on a `receipt`, `qty_delta` on a `count`), and whether `unit_cost_cents: null` on a non-receipt counts as "a unit cost".
  5. The controller method of `GET /api/v1/reports/inventory/export` isn't named.
- Proposal (**implemented provisionally** in `App\Actions\Dashboard\BuildInsights`, `DescribeAuditEntries`, `App\Actions\Reports\BuildInventoryReportAction`, `App\Http\Requests\Admin\Catalog\StoreStockAdjustmentRequest`, `ReportController`):
  1. `stock_out`: `Stock in these products or mark them unavailable.`; `stock_low`: `Reorder these products before they run out.`
  2. `Removed reorder level of "Iced Tea"`.
  3. Every product matching the filters, as the sales report's totals ignore its row cap. The truncated rows are therefore still counted (so `totals` can exceed the sum of `rows`).
  4. The unused quantity field returns Laravel's `422` `The counted qty field is prohibited.` / `The qty delta field is prohibited.` A `null` counts as not sent (as for `qty_delta`/`counted_qty` since Phase 3), so `unit_cost_cents: null` is accepted on every type; only a value gets `Only stock in has a unit cost.` A `type: null` is `adjustment`.
  5. `ReportController@inventoryExport` (the sales export is `@export`).
  No JSON shape changes.
- Resolution: All five accepted as implemented. On item 3, the report's flow totals cover every product that matches the filters, even when the rows are truncated (the Inventory section is corrected to say so). — RESOLVED (2026-09-27)

### Q-023 [FRONTEND→MAIN] SC/PWD on the tablet: print and cart details the device rules leave open — RESOLVED
- Raised by: frontend-agent · Feature: Senior Citizen / PWD Discount · Endpoint: none (Device rules → Cart and checkout, Receipt; Reports → X/Z-read)
- Problem: The device rules don't pin down these details:
  1. **Receipt marker in `headcount` mode.** "A marked line prints `  SC/PWD` under it", but `items[].sc_pwd` is also `true` for every line given a share in `headcount` mode.
  2. **X/Z-read layout.** "prints `SC/PWD (N)`, `VAT exempted` (when not 0) and `SC/PWD discount` after Discounts": no amount is given for `SC/PWD (N)`, nor whether the lines print on a shift with no SC/PWD sale.
  3. **Void slip.** It prints "the lines as on the receipt" then `TOTAL VOIDED`; with SC/PWD the lines alone don't add up to the total (the same gap Q-017 closed for the order discount).
  4. **Tile taps.** A tap adds 1 to an existing line of that product with no discount and no note; it isn't said whether an SC/PWD-marked line is topped up (the extra unit may not be the senior's).
  5. **Where lines are ticked**, and what happens when the marked lines or the whole cart are removed.
- Proposal (**implemented provisionally**, each marked `TODO(Q-023)`; no API change):
  1. Literal: every line with `items[].sc_pwd: true` prints `  SC/PWD`, so in `headcount` mode every line with a share does (`mobile/src/printing/documents/receipt.ts`). The order detail shows the chip the same way; the cart shows it on the ticked lines (`items` mode).
  2. Under `Discounts`, indented 2: `  SC/PWD (N)` with no amount, `  VAT exempted  -31.61` only when not 0, `  SC/PWD discount  -52.68`, printed on every X/Z-read (`(0)` and `0.00` when there is none) (`mobile/src/printing/documents/shiftRead.ts`). The Shifts screen shows the same rows; the Reports totals add an `SC/PWD (N)` tile (and `VAT exempted (SC/PWD)` when not 0); the dashboard adds them only when there is an SC/PWD sale today.
  3. The void slip prints `VAT exempted (SC/PWD)` (when `vat_exempt`) and `SC/PWD discount 20%` after the lines, like the receipt, so they add up to `TOTAL VOIDED` (`mobile/src/printing/documents/voidSlip.ts`).
  4. A marked line is never topped up: the tap starts a new, unmarked line (`mobile/src/stores/cart.ts`).
  5. The SC/PWD sheet lists the cart's lines as checkboxes (a line with a discount says it is removed if ticked); lines added later are ticked by reopening the sheet (**Edit** on the cart's SC/PWD row). Removing every marked line keeps SC/PWD and blocks **Charge** with `Tick the items for the senior citizen or PWD.`; emptying the cart drops SC/PWD. The ID number check is exact after trimming (as Laravel's `distinct`), and the app trims before sending.

- Resolution: All five accepted as implemented. — RESOLVED (2026-09-28)

### Q-024 [BACKEND→MAIN] SC/PWD: a refund VAT split that can go −1, and details the rules leave open — RESOLVED
- Raised by: backend-agent · Feature: Senior Citizen / PWD Discount · Endpoint: POST /api/v1/orders, POST /api/v1/sync/orders, POST /api/v1/orders/{ulid}/refunds, the reports
- Problem:
  1. **Refund VAT split.** For a partial refund, `rhu(τ × (p + k), n) − rhu(τ × p, n)` can exceed the line's refund amount `rhu(T × (p + k), n) − rhu(T × p, n)` by 1 when `0 < X < n`, which makes that line's VAT-exempt part `−1` (e.g. `T = 2`, `τ = 1`, `n = 3`, refunding the 2nd unit: amount `0`, taxable `1`). The refund columns are unsigned, so the formula taken literally fails the insert. It needs a tiny `X` spread over many units (headcount mode with many diners), so it is rare but reachable.
  2. `sc_pwd.persons.*.type` lists only `in:senior_citizen,pwd`; a person without a `type` can't be printed or stored meaningfully.
  3. `items.*.sc_pwd: true` in `headcount` mode ("must be `false`") has no message.
  4. `sc_pwd: {}` (an empty object) is neither "null or omitted" nor valid.
  5. "The existing report indexes cover the new sums": the sales report's totals and product/category rows are index-only on `orders_sales_report_index` / `order_items_sales_report_index` (Phase 6 budget), which don't carry the new columns.
  6. Field positions and the audit when there is no SC/PWD aren't stated.
- Proposal (**implemented provisionally**):
  1. A line's taxable refund part is clamped to `0..amount`: `v_i = min(amount_i, rhu(τ × (p + k), n) − rhu(τ × p, n))`, and `vat_exempt_sales_cents = Σ amount − V`. It only differs from the literal formula in that edge case (the refund amount itself is unchanged, and a full refund still returns exactly `total_cents`). The app needs the same `min` (`RefundCalculator::taxableAmount`).
  2. `type` is `required` (Laravel's `The type field is required.`).
  3. The same message as a marked line without `sc_pwd`: `The selected sc pwd is invalid.` on `items.{i}.sc_pwd`.
  4. `422` on `sc_pwd`: `The sc pwd field must have a value.`
  5. The migration rebuilds both indexes with the new columns appended (`sc_pwd_mode`, `sc_pwd_vat_relief_cents`, `sc_pwd_discount_cents` on orders; `sc_pwd_vat_relief_cents`, `sc_pwd_discount_cents` on order_items), so both performance tests still pass.
  6. `Order.sc_pwd` sits right after `order_discount`; `items[]` gain their four fields after `refunded_cents`; `OrderSummary.has_sc_pwd` comes last; `ShiftReport` gets the three figures after `vat_exempt_sales_cents`, and the sales report `totals` and dashboard `sales` after `vat_amount_cents`. The `order.completed` audit always carries `sc_pwd` (`null` without SC/PWD), like `authorized_by`. `distinct` on `id_no` is exact (case-sensitive), after Laravel's trimming. The other SC/PWD field display names are `mode`, `persons`, `type`, `ID number`, `diners` and `VAT exempt`.

- Resolution: All six accepted as implemented. Item 1 becomes the rule on both sides: a line's taxable refund part is `v_i = min(amount_i, rhu(τ × (p + k), n) − rhu(τ × p, n))`, and the refund's VAT-exempt amount is `Σ amount − V` (the SC/PWD section is updated). — RESOLVED (2026-09-28)

### Q-025 [FRONTEND→BACKEND] Units and ingredients: response shapes and details §A/§D leave open — RESOLVED
- Raised by: frontend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: GET /api/v1/units, GET/POST/PATCH /api/v1/admin/ingredients(/{id}), POST/DELETE /api/v1/admin/ingredients/{id}/image
- Problem:
  1. `GET /units` has a table but no JSON shape (envelope, pagination, field names, the type of `factor_to_base`). The same goes for `Ingredient.units[].factor`: a JSON number can't carry 10 exact decimals.
  2. "The base unit is immutable once the ingredient is in use", but `Ingredient` has no field that says so; the app only learns it from the `409` after the user has changed it.
  3. The admin ingredient list has no query parameters or order, and the image endpoints are only "like products".
  4. The reserved-code rule doesn't say whether it is case-insensitive (`KG` on a `g` ingredient), although the name uniqueness is.
  5. The branch fields of an ingredient with no `stock_levels` row aren't given.
- Proposal:
  1. `GET /api/v1/units` → `200 { "data": [ { "code": "kg", "name": "Kilogram", "dimension": "mass", "factor_to_base": "1000" } ] }`, not paginated, in the table's order. `factor_to_base` and `units[].factor` are **decimal strings** (`"28.349523125"`, `"25000"`); the app sends `factor` as a string too, and accepts a number when reading.
  2. Add `base_unit_locked` (boolean) to `Ingredient`: `true` once it has any movement, recipe line or PO line. **Implemented provisionally** without it: the base-unit picker locks when `last_movement_at` is not `null`, or after the `409` (the change is undone and the message shows). Marked `TODO(Q-025)` in `mobile/src/hooks/ingredients/useIngredientForm.ts`.
  3. `GET /api/v1/admin/ingredients`: `per_page`, `cursor`, `search` (max 100, name contains), `is_active` (boolean); ordered by `name`, then `id`. `POST /api/v1/admin/ingredients/{id}/image` (multipart `image`) → `200 { data: Ingredient }`; `DELETE /api/v1/admin/ingredients/{id}/image` → `200 { data: Ingredient }` (as products). `Ingredient` also carries `image_path`, per Global Conventions.
  4. Case-insensitive, like the uniqueness rule: the app blocks `KG` on a `g` ingredient with `"KG" is already a standard unit.`
  5. `qty: "0.000"`, `reorder_level: null`, `status: "out"`, `avg_cost: "0.000000"`, `stock_value_cents: 0`, `last_movement_at: null`.
- Resolution: Accepted as the backend built it. `GET /units` is `{data:[{code,name,dimension,factor_to_base}]}` with the factors as decimal strings, not paginated. `Ingredient` gains **`base_unit_locked`** (true once there is any movement, PR item or PO line), and the app uses it instead of its `last_movement_at` heuristic. `Ingredient` also includes `image_path`. The reserved-code check is case-insensitive. — RESOLVED (2026-09-29)

### Q-026 [FRONTEND→BACKEND] Ingredient inventory: list items, movement items, and the adjustment and reorder-level bodies — RESOLVED
- Raised by: frontend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: GET /api/v1/inventory/ingredients(/{id}(/movements)), PUT /api/v1/inventory/ingredients/{id}/reorder-level, POST /api/v1/admin/ingredients/{id}/stock-adjustments
- Problem: §D says these "mirror Inventory" but doesn't give the item shapes or the exact bodies:
  1. What the list and single-item reads return.
  2. The movement item: the quantity types, and the `reference` of a PO receipt (`kind` value, `ulid`, `label`).
  3. The adjustment body with `{qty, unit}`: the field names per `type`, and the sign of `qty` for `wastage` (products send a negative `qty_delta`).
  4. The reorder-level body "`{qty, unit}` or `null`": whether it is wrapped in `reorder_level`.
- Proposal (**implemented provisionally** that way, marked `TODO(Q-026)` in `mobile/src/services/ingredients.ts` and `mobile/src/services/types.ts`):
  1. The list items and `GET /inventory/ingredients/{id}` are the `Ingredient` resource (with the branch fields), ordered by `name`, then `id`. `status` accepts `in_stock,low,out,alerts`; `search` matches the name. `meta.summary = {tracked, low, out}` for the whole branch.
  2. Movement item: `{ "ulid", "type", "qty_delta": "-240.000", "qty_after": "29760.000", "entered_qty": "2.000" | null, "entered_unit": "cup" | null, "unit_cost_cents": int | null, "value_cents": int, "reason": string | null, "occurred_at", "created_by": {id,name} | null, "reference": { "kind": "order" | "refund" | "purchase_order", "ulid", "label" } | null }`. For a receipt, `kind` is `purchase_order`, `ulid` is the PO's ULID and `label` its `po_no`.
  3. Body `{ ulid, type?: "adjustment" | "count" | "wastage", qty, unit, reason }` (`reason` required for all three): `adjustment` → `qty` ≠ 0 (signed delta); `count` → `qty` ≥ 0 is the counted quantity (the server works out the delta); `wastage` → `qty` < 0, as products' `qty_delta`. `receipt` → `422` on `type`. 422 keys `qty`, `unit`, `reason`. `201 { data: <the movement item + ingredient_id, qty_before> }`; the app reads nothing from it but success, and then refetches the ingredient and its history.
  4. `{ "reorder_level": { "qty": "5", "unit": "kg" } }` or `{ "reorder_level": null }` → `200 { data: Ingredient }`. 422 keys `reorder_level`, `reorder_level.qty`, `reorder_level.unit`.
- Resolution: Accepted. List and read items are `Ingredient`. Movement `reference.kind` is `order|refund|purchase_order`, and `value_cents` is always an integer. The adjustment body is `{ulid, type?, qty, unit, reason}`: its 201 is the movement item plus `ingredient_id`, `qty_before` and `qty_after`, and its 422s come on `qty`/`unit`/`reason`. The reorder body is `{reorder_level:{qty,unit}|null}`. — RESOLVED (2026-09-29)

### Q-027 [FRONTEND→BACKEND] Purchase requests and orders: shapes §F–§H leave open — RESOLVED
- Raised by: frontend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: /api/v1/purchase-requests…, /api/v1/purchase-orders…
- Problem:
  1. PR item, PO line and receipt quantities: strings for every item, or integers for `product` items ("product quantities stay integers")?
  2. `timeline[].details` has no type.
  3. `PurchaseOrder.created_by` / `approved_by` have no shape, and `receipts[]` has no item shape.
  4. The PO `PATCH` body isn't spelled out.
  5. Whether the list endpoints return the full resources.
  6. A `purchase.request` holder without `product.manage` has no endpoint that lists `own`-stock (`track_stock`) products for the item picker (`GET /admin/products` needs `product.manage`; `GET /inventory` needs `inventory.adjust` or `report.view`).
- Proposal:
  1. Always decimal strings with 3 decimals (`"2.000"`), for product items too; the app reads either.
  2. `details`: `string | null`, already worded (e.g. the decline reason, `2 sack Flour`); `action` is the audit slug (`pr.created`, `pr.item_approved`, `pr.item_declined`, `po.created`, `po.approved`, `po.declined`, `po.received`, …). `by` may be `null` for system entries.
  3. `created_by`, `approved_by`: `{id, name} | null`. `receipts[]` (newest first): `{ "ulid", "received_by": {id,name}, "received_at", "remarks": string | null, "lines": [ { "po_line_id", "qty", "unit", "base_qty", "cost_cents", "reason": string | null } ] }`.
  4. `PATCH /purchase-orders/{ulid}`: `{ expected_delivery_date?: "YYYY-MM-DD" | null, remarks?: string | null, lines?: [ { id, qty?, unit?, unit_price_cents?, supplier_id? } ] }`; 422 keys `lines.{i}.qty` etc.
  5. Yes: the lists return the same `PurchaseRequest` (with `items`) and `PurchaseOrder` (with `lines`; `receipts` and `timeline` may be `[]` in lists).
  6. **Implemented provisionally:** the picker searches `GET /api/v1/products?search=` and keeps `track_stock` products (Round B: `stock_mode = own`). Marked `TODO(Q-027)` in `mobile/src/hooks/purchasing/usePurchaseItemPicker.ts`. A cleaner option is to let any purchase permission read `GET /api/v1/inventory`.
- Resolution: Accepted, with one difference: **product quantities stay integers**, and only ingredient quantities are 3-decimal strings (the app reads both). `timeline[].details` is a worded string or `null`. Lists return full resources (PR list items include `timeline`). The item picker uses `GET /products?search=`, filtered client-side to `track_stock`, until Round B adds `stock_mode`. — RESOLVED (2026-09-29)

### Q-028 [FRONTEND→BACKEND] Purchasing report and the ingredient inventory report: JSON shapes — RESOLVED
- Raised by: frontend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: GET /api/v1/reports/purchasing(/export), GET /api/v1/reports/inventory?kind=ingredients(/export)
- Problem: §I lists the row fields and totals but not the JSON (`pos` "by status", names or objects for people, nullability when there is no PO), whether `receiving_status` filters the PO or the line, or the CSV file name. §D names the ingredient report's flow columns but not its identity fields, the "value in and out" field names, or its totals.
- Proposal (**implemented provisionally**, marked `TODO(Q-028)` in `mobile/src/services/types.ts`):
  1. `{ "data": { "from", "to", "totals": { "prs", "items", "approved", "declined", "pending", "pos": { "pending_approval", "approved", "declined" }, "ordered_cents", "received_cents", "remaining_cents" }, "rows": [ { "pr_no", "pr_date", "requested_by": "<name>", "item_name", "supplier_name", "requested_qty", "unit", "decision", "decision_reason", "decided_by": "<name>" | null, "po_no", "po_status", "ordered_qty", "received_qty", "remaining_qty", "line_receiving_status", "unit_price_cents", "ordered_cents", "received_cents", "last_received_at" } ] }, "meta": { "truncated": false } }`. The PO fields are `null` when the item has no PO line. `receiving_status` filters the **line** (`pending,partial,complete,over_received`), matching the row. CSV: `purchasing-<from>-<to>.csv`.
  2. Ingredient rows: `{ "ingredient_id", "name", "base_unit", "opening_qty", "received", "used", "returned", "wasted", "adjusted", "closing_qty", "reorder_level", "status", "avg_cost", "stock_value_cents", "value_in_cents", "value_out_cents" }` (quantities as 3-decimal strings). Totals: `{ "tracked", "low", "out", "stock_value_cents", "value_in_cents", "value_out_cents" }`. `category_id` is ignored for `kind=ingredients`. The app shows the totals it finds and only the columns listed here.
- Resolution: Accepted as proposed. The purchasing report's `receiving_status` accepts both line and PO values, as a superset. `category_id` is ignored for `kind=ingredients`. — RESOLVED (2026-09-29)

### Q-029 [FRONTEND→BACKEND] Dashboard: the action keys of the three purchasing insights — RESOLVED
- Raised by: frontend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: GET /api/v1/dashboard (insights)
- Problem: §I gives `purchase_requests_pending`, `purchase_orders_pending` and `purchase_orders_to_receive` with their severity and permission, but not their `action` (the app destination key). `ingredients_out` / `ingredients_low` do have one (`inventory.ingredients.alerts`).
- Proposal: `purchasing.requests.pending` (opens Purchase requests with **Needs my decision**), `purchasing.orders.pending` (opens Purchase orders filtered to Pending Approval), `purchasing.orders.to_receive` (opens Receiving). **Implemented provisionally** in `mobile/src/hooks/dashboard/dashboardModel.ts` (`INSIGHT_TARGETS`, marked `TODO(Q-029)`); an unknown key still shows the insight without a button.
- Resolution: Accepted: `purchasing.requests.pending`, `purchasing.orders.pending`, `purchasing.orders.to_receive`. — RESOLVED (2026-09-29)

### Q-030 [BACKEND→MAIN] Ingredients & Purchasing (Round A): rules §A–§I leave open — RESOLVED
- Raised by: backend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: the Round A endpoints (suppliers, ingredients, ingredient inventory, purchase requests and orders, receipts, the reports)
- Problem: These rules aren't pinned down (the response shapes are covered by Q-025 to Q-029):
  1. **`avg_cost` on a correction** (a negative receipt): §B gives the formula for a receipt of `b` costing `c`, but not for `b < 0`, nor when `q + b ≤ 0`.
  2. **409 wording** for a cancelled PR and for approving/declining a PO that isn't pending; the PO decline's self-approval rule ("approving your own PO" only mentions approve).
  3. **PR `DELETE`** response: 204 (the admin delete pattern) or the PR.
  4. **Item rules on a PR:** a product's quantity (products stay integers), an item whose unit factor makes `base_qty` round to 0, the messages for an inactive ingredient or supplier, and whether a PR edit sends complete item objects.
  5. **"In use"** for the immutable base unit (movement, recipe line or PO line): a PR item still pending carries a `base_qty` in the old base unit.
  6. **Ingredient delete / unit guards:** the 409 wording, what "open PO" means for the delete, and a rename of a unit on an open PO line.
  7. **Receipt cost** `line_unit_base_factor` = "the base qty of 1 unit": rounded to 3 decimals, it is 0 for a unit under 0.0005 of a base unit (division by zero).
  8. **Purchasing totals and CSV:** which POs `ordered_cents` / `received_cents` / `remaining_cents` cover; the CSV `TOTAL` line; the row order.
  9. **Ingredient report CSV** layout and the insight messages.
- Proposal (**implemented provisionally**; no shape beyond Q-025 to Q-029):
  1. A correction uses the receipt formula with `b` and `c` negative: `avg_cost = round_half_up((q × avg + c) / (q + b), 6)`, `value_cents = c`. When `q + b ≤ 0`, or the result would be negative (the stock was used meanwhile), `avg_cost` is unchanged. Exact reversal otherwise, so Σ `value_cents` keeps matching the stock value (worked example I ends at 55000 g, ₱2,600.00).
  2. `409 "This request was cancelled."` (edit, cancel, decide a cancelled PR); `409 "This order is no longer pending approval."` (approve/decline). Declining applies the same self-approval rule as approving ("decide" in `purchase.approve_own`); audits carry `self_approved: true`.
  3. `204`, no body; the PR stays readable with `status = cancelled` (`pr.cancelled`).
  4. A product quantity must be whole: `422 "A product quantity must be a whole number."` (products use `pc` only). `base_qty` rounding to 0: `422 "The quantity is too small for this unit."`; above 1,000,000,000 base units: `"The quantity is too large for this unit."`. An inactive/deleted ingredient: `"This ingredient is inactive."` / `"The selected item is invalid."`; a product not tracking stock: `"This product doesn't track stock."`; an inactive supplier: Laravel's `The selected items.{i}.supplier_id is invalid.` A PR edit sends complete item objects (the create rules), with `id` for kept items. `remarks` max 500 (PR and PO), item `remarks` and reasons max 255, `contact_person` max 120.
  5. "In use" also counts PR items (any status), so `base_unit_locked` is true from the first PR.
  6. Delete: `409 "This ingredient is on an open purchase order."` while it is on a PO that is neither declined nor fully received (recipes join in Round B). Units: `409 "The unit \"sack\" is on an open purchase order."` when a unit on a line that is `pending`/`partial` of a non-declined PO is removed, renamed (other than letter case) or re-factored. Stored rows keep a `unit_factor` snapshot, so a unit edited or removed later never changes a PR, PO or receipt.
  7. The exact factor of the line's unit: `cost_cents = round_half_up(unit_price_cents × base_qty / factor, 0)` in one exact division (same result for every catalog unit and the worked example). An ingredient receipt's `unit_cost_cents` is the price of the **entered** unit (`round_half_up(unit_price × entered_factor / line_factor, 0)`); a product's is per `pc`. Line statuses compare the received quantity in the line's unit (3 decimals) with the ordered one, so 3 × 1 cup never reads `partial` against 3 cups by rounding.
  8. The money totals cover the lines of **approved** POs; `remaining_cents` = Σ max(`line_total_cents` − `received_cents`, 0). Rows ordered by PR creation, PR id, item id. CSV header: the row fields with `unit_price`, `ordered`, `received` in pesos; `TOTAL,<prs>,,,,<items>,,,,,,,,,,,,<ordered>,<received>,`. `receiving_status` accepts the line values (filtering the line) and also the PO values (filtering the PO).
  9. Ingredient CSV: `inventory-ingredients-<from>-<to>.csv`, header `ingredient_id,name,base_unit,opening_qty,received,used,returned,wasted,adjusted,closing_qty,reorder_level,status,avg_cost_cents,stock_value,value_in,value_out`, and `TOTAL,,,,,,,,,,,,,<stock_value>,<value_in>,<value_out>`. Insights: `N ingredients are out of stock` / `Receive or count these ingredients.`; `N ingredients are running low` / `Request these ingredients before they run out.`; `N purchase requests need a decision` / `Approve or decline the items of these requests.`; `N purchase orders are waiting for approval` / `Approve or decline these orders.`; `N purchase orders are ready for receiving` / `Record the deliveries when they arrive.` (singulars `1 … is/needs`).
- Resolution: All nine items accepted as implemented. The noteworthy ones: a correction reverses `avg_cost` through the receipt formula, which stays unchanged when the result would be ≤ 0; receipt cost uses the unit's exact factor; the purchasing money totals cover approved POs only; PR items count towards the base-unit lock. — RESOLVED (2026-09-29)

### Q-031 [FRONTEND→BACKEND] Recipes and stock modes (Round B): shapes and rules §J leaves open — RESOLVED
- Raised by: frontend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: GET/POST/PATCH /api/v1/admin/products(/{id}), GET /api/v1/products, GET/PUT /api/v1/admin/products/{id}/recipe, POST /api/v1/admin/products/{id}/recipe/apply-cost, GET /api/v1/inventory/ingredients/{id}/movements
- Problem:
  1. §J adds `stock_mode` to products but doesn't say which responses carry it. The purchase item picker reads `GET /products` (Q-027), which must tell `own` from `recipe`.
  2. The product body: whether `track_stock` is still accepted in requests, and which wins when both are sent.
  3. `Recipe` has no JSON example: the type and scale of `lines[].unit_cost` (a decimal string like `avg_cost`? an integer for products?), the type of `lines[].qty` for a product component, whether `margin_bps` can be `null` (price 0), and the line order.
  4. What `GET` and `PUT …/recipe` do for a product whose `stock_mode` isn't `recipe`.
  5. The `PUT` 422 keys and messages: duplicate components, an ingredient that is inactive, a product component that isn't `own`, a fractional product quantity, more than 50 lines.
  6. The `apply-cost` response and its errors (not `recipe`, no lines).
  7. How the ingredient history shows a refund's wasted share, since "no stock movement is written" but the history shows it as wasted.
- Proposal (implemented provisionally, marked `TODO(Q-031)` in `mobile/src/services/types.ts`, `mobile/src/services/recipes.ts`, `mobile/src/utils/recipe.ts`, `mobile/src/hooks/menu/useRecipeBuilder.ts` and `mobile/src/hooks/purchasing/usePurchaseItemPicker.ts`):
  1. Every `Product` response carries `stock_mode` (admin, `GET /products`, `GET /products/{id}`), next to `track_stock`. The app falls back to `track_stock` (`own`/`none`) when it's missing, so nothing breaks either way.
  2. The app sends `stock_mode` only (`in:own,recipe,none`, default `none` on store, `sometimes` on update). `track_stock` stays accepted for old clients, and `stock_mode` wins when both are sent.
  3. `GET/PUT …/recipe` → `200 { "data": { "lines": [ { "component": { "type": "ingredient", "id": 5, "name": "Flour", "base_unit": "g" }, "qty": "1.000", "unit": "cup", "base_qty": "120.000", "unit_cost": "4.666667", "line_cost_cents": 560 } ], "cost_cents": 2484, "price_cents": 8500, "margin_bps": 7078 } }`. `unit_cost` is always a decimal string, in centavos per base unit, with 6 decimals: an ingredient's `avg_cost`, or a product's `cost_cents` (`"1500.000000"`). A product's `qty` and `base_qty` are 3-decimal strings too. `margin_bps` = `round_half_up((price − cost) × 10000 / price)`, and `null` when `price_cents = 0`. Lines come back in the order sent.
  4. `GET` returns the kept lines for any product (the app only calls it for `recipe` products). `PUT` → `409 "This product doesn't use a recipe."` when `stock_mode ≠ recipe`.
  5. The keys are `lines`, `lines.{i}.component_type`, `lines.{i}.component_id`, `lines.{i}.qty` and `lines.{i}.unit`:
     - a duplicate → `lines.{i}.component_id` `"This component is already on the recipe."`;
     - an inactive or deleted ingredient → `"This ingredient is inactive."` / `"The selected item is invalid."` (as Q-030);
     - a product that isn't `own` → `lines.{i}.component_id` `"Only items with their own stock can be components."`;
     - a product quantity → a whole number, `"A product quantity must be a whole number."` (as Q-030);
     - more than 50 lines → `lines` `"Use at most 50 components."`;
     - the unit → `Add "<unit>" to <name>'s units first.` (§A).
  6. `POST …/apply-cost` → `200 { "data": Product }` (the admin product, with the new `cost_cents`). It returns `409 "This product doesn't use a recipe."` when not `recipe`. An empty recipe sets the cost to 0. If the answer isn't a `Product`, the app refetches `GET /admin/products/{id}` instead.
  7. The ingredient movement list gets one row per refunded component share: `type: "refund"`, `qty_delta: "0.000"` (stock unchanged), `qty_after` = the balance at that time, `value_cents: 0`, `reason` = the refund's reason, and `reference: { kind: "refund", ulid: <order ulid>, label: <invoice_no> }`. The app labels `sale` rows `Used · sale`, `void` rows `Returned · void`, and `refund` rows (or a `wastage` row referencing a refund) `Wasted · refund`. The wasted quantity itself isn't in the item. The backend could add a field for it; the app would then show it.
- Resolution (2026-09-29, main session): items 1, 2, 4, 5 and 6 as proposed. Items 3 and 7 changed, as built (Q-032):
  - **Item 3:**
    - A **product** component's `qty` and `base_qty` are **integers** (Q-027); an ingredient's are 3-decimal strings. `unit_cost` is always a 6-decimal string.
    - `margin_bps` uses `Margin::bps`: `trunc((price − cost) × 10000 / price)` toward zero, and it is **`null` when `price_cents = 0` or `cost_cents = 0`**. The app's preview must match it exactly: example J gives `trunc(6016 × 10000 / 8500)` = **7077**.
    - Lines come back in the order sent.
  - **Item 7:** there is no `refund` type. Each refund adds one entry per ingredient:
    - `type: "wastage"`, `qty_delta: "0.000"`, `qty_after` = the balance at that time;
    - **the wasted quantity in `entered_qty` + `entered_unit`** (the base unit);
    - `unit_cost_cents: null`, `value_cents: 0`, `reason: "Refund INV-…: <reason>"`;
    - `reference: {kind: "refund", ulid: <order ulid>, label: <invoice_no>}`, `ulid` = the refund's ULID.

    The app labels a `wastage` entry with `reference.kind = "refund"` as `Wasted · refund` and shows `entered_qty entered_unit`. A `type=wastage` filter includes these entries.

### Q-032 [BACKEND→MAIN] Recipes & depletion (Round B): rules §J leaves open, and how Q-031 was built — RESOLVED
- Raised by: backend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: GET/PUT /api/v1/admin/products/{id}/recipe, POST …/recipe/apply-cost, PATCH /api/v1/admin/products/{id}, POST /orders, POST /sync/orders, void, refunds, GET /sync/stock, GET /inventory/ingredients/{id}/movements, GET /reports/inventory?kind=ingredients
- Problem: §J doesn't pin down these points (the shapes are Q-031's):
  1. **Where the refund waste is stored.** One refund can take part of a line and a later refund more, so a single `refund_id` on `order_item_components` can't link them. §K lists no table for it.
  2. **The refund waste in the ingredient history** (Q-031 item 7).
  3. **The report period of a refund's waste.** Is it counted on the refund's day or on the sale's day?
  4. **The switching rule's scope.** "Stock ≤ 0" doesn't say which branch.
  5. **Components whose state changes later.** A product component can later leave `own`; the rule for a component that is inactive when a recipe is saved isn't given.
  6. **Value after a void.** A void returns at the snapshot cost with `avg_cost` unchanged (§B). When `avg_cost` has moved since the sale, Σ `value_cents` no longer equals `qty × avg_cost` for that ingredient.
  7. **The product quantity type in `Recipe`,** and **`margin_bps`** (Q-031 items 3 and 6).
- Proposal (**implemented provisionally**):
  1. **A new table `refund_item_components`:** `refund_id`, `refund_item_id`, `order_item_component_id`, `branch_id`, the component, the wasted `base_qty`, and `occurred_at` (the refund's time). All foreign keys are RESTRICT. The snapshot's `wasted_base_qty` accumulates alongside it.
  2. **One history entry per refund and ingredient:**
     - `type: "wastage"`, `qty_delta: "0.000"`, and `qty_after` = the balance at that time (it stays exact because the entry doesn't move stock);
     - the wasted quantity in `entered_qty` + `entered_unit` (the base unit), with no new field;
     - `unit_cost_cents: null`, `value_cents: 0`, `reason: "Refund INV-…: <reason>"`;
     - `occurred_at` = the refund's time, `created_by` = the refunder, `reference: {kind:"refund", ulid:<order ulid>, label:<invoice_no>}`, `ulid` = the refund's ULID;
     - `type=wastage` filters include it.
  3. **The refund's day,** like every Phase 7 refund figure. In that period the report subtracts the share from `used` and adds it to `wasted`; the closing invariant is unchanged. `used` can go negative in a period whose refunds of earlier sales exceed its own depletion.
  4. **Every branch:** leaving `own` returns `409 "Use up or write off the stock first."` while any branch has qty > 0.
  5. **Component rules:**
     - Depletion skips a product component that is no longer `own`, and so do the `/sync/stock` badges. The recipe row is kept, and GET still lists and costs it.
     - An inactive or deleted ingredient is rejected on PUT (as Q-030).
     - An ingredient can't be deleted while it is on a recipe of a non-deleted product: `409 "This ingredient is on a recipe. Remove it from the recipe first."`.
     - `base_unit_locked` also counts recipe lines.
  6. **Kept as §B says.** If the stock value must reconcile exactly, a void could instead be valued at the current `avg_cost`.
  7. **Quantities:** a product component's `qty`/`base_qty` are integers, following the Q-027 resolution. An ingredient's are 3-decimal strings. `unit_cost` is always a 6-decimal string.
  8. **Margin:** `margin_bps` uses the project's `Margin::bps`: truncation toward zero, and `null` when the price **or** the cost is 0. It isn't round-half-up.
  9. **Adopted from Q-031:**
     - `stock_mode` sits on every `Product` (admin and `GET /products`), after `track_stock`;
     - `track_stock` is still accepted, and `stock_mode` wins;
     - PUT and apply-cost on a non-recipe product return `409 "This product doesn't use a recipe."`, while GET returns the kept rows for any product;
     - the 422 messages;
     - apply-cost returns `200 {data: Product}` (the admin product).
- Resolution (2026-09-29, main session): items 1–5 and 7–9 as proposed and built. **Item 6 changes §B:**
  - **A void re-weights the ingredient's average cost at the snapshot cost, exactly as a receipt does:**
    - `q = max(qty_before, 0)` and `avg = round_half_up((q × avg + c) / (q + b), 6)`, where `b` is the returned base qty and `c` is the snapshot Σ `cost_cents`;
    - this is the same code path as `RecordStockMovementAction`'s receipt;
    - the movement's `value_cents` stays `c`.
  - **Why:** the returned goods carry their original cost back. A sale followed by its void then restores both the qty and the value exactly, and Σ `value_cents` reconciles with `qty × avg_cost` (within the receipt rounding) even when a receipt moved the average in between.
  - **Scope:**
    - An `own` product component is unchanged: it has no average and returns at its snapshot `unit_cost_cents`.
    - Refunds are unchanged: no movement, so no value change.

### Q-033 [BACKEND→MAIN] Set cost (D1): route name, the report's "adjusted value", and the unreachable "too small" rule — RESOLVED
- Raised by: backend-agent · Feature: Ingredients, Recipes & Purchasing · Endpoint: POST /api/v1/admin/ingredients/{id}/cost, GET /api/v1/reports/inventory?kind=ingredients
- Problem:
  1. D1 gives no route name or controller for the new endpoint.
  2. D1 says the report "adds the `revaluation` value to `adjusted` value_cents", but the ingredient report row (Q-028) has no per-flow value field: only `value_in_cents` / `value_out_cents`.
  3. `422 cost_cents "The cost is too small for this unit."` can't happen with valid units: `cost_cents ≥ 1` and every factor is ≤ 1,000,000 (§A), so `new_avg ≥ 0.000001`. It only triggers for a unit above 2,000,000 base units.
- Proposal (**implemented provisionally**; no shape change):
  1. Route `v1.admin.ingredients.cost.store`, `Api\V1\Admin\IngredientCostController@store`, middleware `auth:sanctum` + `idempotent` (as the ingredient stock adjustments).
  2. `revaluation` is one of the `adjusted` flow's types. Its `qty_delta` is 0, so `adjusted` (a quantity) and the quantity invariant don't change. Its `value_cents` counts in `value_in_cents` (a raise) or `value_out_cents` (a cut) like every movement, so over the whole history `value_in_cents − value_out_cents` = `stock_value_cents`. The CSV is unchanged.
  3. The rule is kept as a guard, and is tested with a unit stored directly at 3,000,000.
- Resolution (2026-09-29, main session): all three as proposed and built. §D1's "adjusted value_cents" means `value_in_cents` / `value_out_cents`. There is no shape change.

### Q-034 [BACKEND→MAIN] Web POS & Print Bridge (W1): print-job and agent details §C–§E leave open — RESOLVED
- Raised by: backend-agent · Feature: Web POS & Print Bridge · Endpoints: POST /api/v1/print-jobs, POST /api/v1/print-agent/jobs/claim, POST /api/v1/print-agent/jobs/{ulid}/result, `print-agent:run`, POST /api/v1/devices/register
- Problem:
  1. `POST /print-jobs` with a `ulid` that already belongs to **another branch's** job: neither a replay (branch-scoped) nor a new job (the column is UNIQUE). No outcome is defined.
  2. `payload_base64` that isn't valid base64 (or decodes to 0 bytes) has no message; only "too large" is defined.
  3. `last_error` on the result transitions: §E sets it only for a final `failed`. Unclear for a retryable failure that goes back to `queued`, and for a later `printed`.
  4. A dead printer "skips the rest of its group in that round", but those jobs are already claimed (`printing`, `attempts + 1`). Left unreported they sit for 60 s until the stale reclaim.
  5. Which transport errors are retryable besides connect errors: a write that breaks mid-document may have printed part of it.
  6. A stale `printing` job (crashed agent) is reclaimed with no attempt cap, so an agent that dies on one job reclaims it forever.
  7. §D lists one index; the first-print dedupe looks up `(order_ulid, kind, printer_id, copy_no)` in the branch, which would scan the branch's jobs.
  8. §C: "Admin device items (Phase 8) also show it". The Phase 8 admin device endpoints aren't built yet (the section is a DRAFT), so there's nothing to extend in W1.
- Proposal (**implemented provisionally**; no response shape changes):
  1. `422` on `ulid` with Laravel's standard `The ulid has already been taken.` (a `unique` rule limited to other branches). A same-branch ULID is a replay (`200`).
  2. `422` on `payload_base64`: `The print data must be valid base64.`
  3. Retryable → `queued`: `last_error` keeps the agent's `error` (the web app can show "retrying: …"), and `claimed_by`/`claimed_at` are cleared. `printed`: `last_error` is cleared. Final `failed`: `last_error` = `error` (it may be `null` when the agent sent none). The user retry clears `last_error`, `claimed_by` and `claimed_at`.
  4. The agent reports each skipped job right away as `failed`, `retryable: true`, with the same connect error. That counts as an attempt (the printer was just found dead), so after 3 dead rounds the jobs are `failed` and the cashier sees **Retry**.
  5. Only connect errors (timeout, refused, unreachable) are retryable. A broken write is reported `failed`, `retryable: false`, so a half-printed document is never re-sent automatically; the cashier can retry it.
  6. No cap is added: the stale reclaim does `attempts + 1` (saturating at the TINYINT's 255). The 3-attempt cap applies only in the result step. Main to decide whether a stale job with `attempts ≥ 3` should be `failed` at claim instead.
  7. Added INDEX `(branch_id, order_ulid)` to `print_jobs`, alongside the required `(branch_id, status, id)`. No column changes.
  8. Only `POST /devices/register` returns `platform` now. The Phase 8 admin device item should gain `platform` when it's built.
- Resolution (main, 2026-10-08): proposals **1, 2, 3, 4, 5, 7 and 8 accepted as implemented** and now part of §D–§E. **6 changed:** the claim step caps stale reclaims. A `printing` job whose `claimed_at` is older than 60 s **and** whose `attempts` is already ≥ 3 is set to `failed` with `last_error` "The print agent stopped responding." and is not returned. Below 3 attempts it is reclaimed as before (`attempts + 1`). So a job is tried at most 3 times whichever way it fails.

### Q-035 [WEB→BACKEND] Open-shift gate: a cashier can't find the terminal's open shift — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge (W1 open-shift gate) · Endpoints: GET /api/v1/shifts, GET /api/v1/shifts/{ulid}
- Problem: The tablet knows its open shift from SQLite. The web terminal has no local database, and the only list (`GET /shifts`) needs `report.zread`, which cashiers don't hold. `GET /shifts/{ulid}` works for a shift of one's own terminal, but only when the ULID is already known. If the browser's storage is cleared (or a second browser profile is used on the same terminal after a reinstall), a cashier sees **Open shift** although the terminal's shift is still open on the server; opening again auto-closes the older shift (flagged `auto_closed`, no counted cash), which splits the drawer's day.
- Proposal: let any authenticated user read the **token device's** open shift, either (a) `GET /api/v1/shifts?device_id=<the token's device>&status=open` allowed without `report.zread` when `device_id` is the caller's own device, or (b) a new `GET /api/v1/shifts/current` → `200 { "data": Shift | null }` for the token's device (`409 "Register this tablet first."` when unbound). Either works for the web client; (b) is simpler.
- Built meanwhile: the web terminal keeps the ULID of the shift it opened in `localStorage` (`pos.shift`, per device) and reads it with `GET /shifts/{ulid}`; a user with `report.zread` falls back to `GET /shifts?device_id=&status=open&per_page=1`; otherwise the gate shows **Open shift**. Marked `TODO(Q-035)` in `web/src/hooks/useCurrentShift.ts`.
- Resolution (main, 2026-10-08): **(b)**. New `GET /api/v1/shifts/current` (route `v1.shifts.current`, any authenticated user) → `200 { "data": Shift | null }`: the open shift of the **token's device**, in the caller's branch, with the same `Shift` resource as `GET /shifts/{ulid}`. Unbound token → `409 "Register this tablet first."`. The web gate calls it on load and after opening a shift; the `pos.shift` localStorage fallback and the `report.zread` list fallback are removed.

### Q-036 [WEB→MAIN] Stock badges on the web Sell screen: no endpoint a web terminal may read — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge §C/§F · Endpoint: GET /api/v1/sync/stock
- Problem: `design-system/pos/pages/sell.md` asks for **Low stock** / **Out of stock** badges on the product cards. The tablet reads them from `GET /sync/stock`, but §C says web terminals never call `/sync/*`. `GET /products` carries no quantity, and the inventory endpoints need `inventory.adjust` or `report.view`, which cashiers don't hold.
- Proposal: allow web terminals to call `GET /api/v1/sync/stock` (read-only, advisory, bounded by the catalogue; no device state changes), refreshed when the Sell screen opens and after each sale. Alternatively, state that the web Sell screen shows no stock badges.
- Built meanwhile: no stock badges; only **Unavailable** (`is_available: false`). An online sale is still blocked by the server's stock `422`, shown on the cart line. Marked `TODO(Q-036)` in `web/src/components/sell/MenuColumn.tsx`.
- Resolution (main, 2026-10-08): **allowed.** Web terminals may call `GET /api/v1/sync/stock` (read-only, advisory) on Sell open, after each sale and every 5 minutes; no other `/sync/*` endpoint. §C is amended. The web Sell screen shows **Low stock** / **Out of stock** badges from it exactly like the tablet; stock never blocks on the client (the server's 422 still does online).

### Q-037 [WEB→MAIN] Receipt "Print sample" and printer "Test print" through the print queue — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge §D · Endpoint: POST /api/v1/print-jobs
- Problem:
  1. Receipt settings → **Print sample** (Printing → Screens) isn't a test page, and no print-job `kind` names it. The web app sends it as `kind: "test"` (no `order_ulid`) with the sample's bytes, to the terminal's receipt printer.
  2. The tablet can test-print **the host being edited before saving**. A print job needs a saved `printer_id`, so the web app only test-prints saved printers (from the Printers list).
- Proposal: confirm both as built (no API change): `kind: "test"` covers the test page and the receipt sample; the printer form has no pre-save test print on web.
- Resolution (main, 2026-10-08): confirmed as built. `kind: "test"` covers both the printer test page and the receipt-settings sample; the web printer form has no pre-save test print (test from the Printers list after saving).

### Q-038 [WEB→MAIN] Catalogue images under the web CSP (`img-src 'self'`) — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge §A/§B · Endpoints: GET /api/v1/products, GET /api/v1/categories
- Problem: `image_url` is absolute, built from the server's `APP_URL`. The web app is served same-origin, and §B limits the CSP to `'self'`. When `APP_URL`'s host differs from the one the browser uses (e.g. `http://localhost` vs the PC's LAN IP), or images live on an S3-compatible disk in production (changelog 0.7), the images are blocked or point to the wrong host.
- Proposal: keep `img-src 'self'` and have the web client use the same-origin path when `image_url`'s path starts with `/storage/` (local `public` disk, also proxied in dev). For an S3 disk, add its origin to the CSP `img-src` at build time (a `VITE_IMAGE_ORIGIN` key) — or confirm images stay on the local disk for the web POS.
- Built meanwhile: the same-origin `/storage/…` path is used for local-disk images; any other origin is loaded as is (and is blocked by the CSP). Marked `TODO(Q-038)` in `web/src/components/sell/SellParts.tsx`.
- Resolution (main, 2026-10-08): accepted. Images stay on the local `public` disk for now; the web client rewrites an `image_url` whose path starts with `/storage/` to the same-origin path. For a future S3 disk, `web/.env.example` gains `VITE_IMAGE_ORIGIN=` (empty by default), added to the CSP `img-src` at build time when set, and such URLs are used as is.

### Q-039 [WEB→MAIN] Needs review: no plain-words label for the Phase 6 reason `shift_closed` — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge (W2) / Offline Sales → Review · Endpoint: GET /api/v1/orders (`review_reasons`), POST /api/v1/orders/{ulid}/review
- Problem: Shifts & Reporting → Order changes adds the review reason **`shift_closed`** (the server flags it: `Order::REVIEW_SHIFT_CLOSED`), but `@pos/core` doesn't know it: `ReviewReason` (`src/contract/types.ts`) and `REVIEW_REASON_LABELS` (`src/sale/reviewReasons.ts`) list only the six Phase 5 reasons, so `reviewReasonLabel('shift_closed')` returns the raw slug. The task asks for the reasons "in plain words". The tablet shows the raw slug too.
- Proposal: add `'shift_closed'` to `ReviewReason` and to `REVIEW_REASON_LABELS`, e.g. `shift_closed: 'Sold after its shift was closed'` (one editor, per the package rules).
- Built meanwhile: the web uses `reviewReasonLabel` and, only when it returns the slug unchanged, shows a readable fallback (underscores to spaces, first letter capitalised: "Shift closed"). Marked `TODO(Q-039)` in `web/src/components/orders/OrderReviewSection.tsx`; nothing else depends on it.
- **Resolution (main, 2026-10-09):** accepted as proposed. `'shift_closed'` was added to `ReviewReason` and `REVIEW_REASON_LABELS` (`shift_closed: 'Sold after its shift was closed'`), so the tablet and the web both show it in plain words. The web keeps its readable fallback for reasons a newer server may add; the TODO marker was removed.

### Q-040 [WEB→MAIN] Roles view: no plain-words label for most permission slugs — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge (W3) / Auth & Access Control → Roles & permissions · Endpoint: GET /api/v1/admin/roles
- Problem: the read-only Roles view lists each role's `permissions[]` (slugs). The contract words only the slugs added after Phase 0 (`customer.manage` "Delete customer records", `settings.manage`, `order.review`, the Phase 6 shift/report slugs, the Phase 7 void/refund authority, §E purchasing, `system.manage`). The Phase 0 slugs (`branch.all`, `discount.apply`, `discount.override`, `inventory.adjust`, `product.manage`, `sale.create`, `user.manage`) have no description, and `GET /admin/roles` returns slugs only. `@pos/core/permissions` has no label map either, so the tablet and the web can't share one.
- Proposal: add a `PERMISSION_LABELS: Record<PermissionSlug, string>` to `@pos/core/permissions` (one editor), with the contract's wording for the later slugs and, e.g., `product.manage` "Manage the menu: categories, products, recipes and ingredients", `user.manage` "Manage staff accounts, roles and PINs", `sale.create` "Make sales and manage customers at the counter", `discount.apply` "Give discounts up to the role's limit", `discount.override` "Approve discounts above the limit", `inventory.adjust` "Stock in, counts, wastage and reorder levels", `branch.all` "Work across every branch". No API change.
- Built meanwhile: the web Roles view shows every slug, plus the contract's own description where one exists (`web/src/utils/permissionLabels.ts`, marked `TODO(Q-040)`); the Phase 0 slugs show as slugs only. Nothing else depends on it.
- **Resolution (main, 2026-10-09):** the server already words every slug in `RolesAndPermissionsSeeder::PERMISSIONS` (stored in `permissions.description`). `@pos/core/permissions` now has `PERMISSION_DESCRIPTIONS` (that wording, word for word, all 21 seeded slugs) and `permissionDescription(slug)` (`null` for an unknown slug). The web's `utils/permissionLabels.ts` was removed and the Roles page uses the shared one. `system.manage` (Phase 8, still a draft) is not seeded yet, so it has no description.

### Q-041 [WEB→MAIN] Dashboard: "Sales by hour" and the stat-card trend badge have no data in the contract — RESOLVED
- Raised by: web-agent · Feature: Web POS & Print Bridge (W5) / Dashboard · Endpoint: GET /api/v1/dashboard
- Problem: `design-system/pos/pages/back-office.md` → Dashboard asks for a **Sales by hour** area chart and a stat-card trend badge "only when the API gives the comparison". The dashboard `sales` section has no hourly buckets (only `last_7_days` per business day) and no comparison figure (e.g. yesterday's or last week's net sales), so neither can be drawn from real data.
- Proposal: either (a) keep the web's **Net sales, last 7 days** area chart (from `sales.last_7_days`, green) in place of Sales by hour and leave the trend badge out (no API change; update the page spec), or (b) add `sales.by_hour: [{ hour: 0–23, orders_count, net_sales_cents }]` (branch wall clock, today's business day, 0-filled) and a comparison figure to the dashboard `sales` section.
- Built meanwhile: option (a). The chart reads only `last_7_days`; no stat card shows a trend badge. Marked `TODO(Q-041)` in `web/src/routes/DashboardPage.tsx`; nothing else depends on it.
- **Resolution (main, 2026-10-09):** W rounds use existing endpoints only, so the web keeps the built **Net sales, last 7 days** chart (`sales.last_7_days`) and `design-system/pos/pages/back-office.md` now asks for that instead of "Sales by hour". The stat-card trend badge already shows only when the API gives a comparison, so none is shown. An hourly breakdown or a comparison period would be a backend change, drafted as its own contract feature if wanted. The TODO marker was removed.

### Q-042 [WEB→MAIN] Web terminal health: whose "latest print job", the print-agent "claimed" rule, and the registration 403 — RESOLVED
- Raised by: web-agent · Feature: Hardening & Pilot (Phase 8) §I · Endpoints: GET /api/v1/print-jobs, POST /api/v1/devices/heartbeat, POST /api/v1/devices/register
- Problem: (1) `GET /print-jobs` answers only for `ulids[]` the caller already knows, so "each printer's latest print job" can only mean the latest job **this terminal** sent; the heartbeat `printers[].ok` and checklist item 4 are therefore per terminal, not per printer branch-wide. (2) Checklist item 5 says "the print agent has claimed a job in the last 10 min, or no job is waiting", but `PrintJob` has no `claimed_at`, so the claim time can't be read; only the §I rule "`queued` jobs older than 2 min mean the agent is down" can be applied. (3) §I says the login page shows the 403 message when registration returns 403 after a retired terminal's re-login, but not whether the user stays signed in.
- Built meanwhile (conservative): (1) the web keeps a short local log (`localStorage` `pos.printJobLog`, newest 50) of the jobs it sent and their last seen status, and reports each printer's latest finished job from it (`printed` = ok, `failed` = not ok, none = left out); (2) the agent check is ✗ only when one of this terminal's jobs has been `queued` for over 2 min, otherwise ✓ ("No print job is waiting", plus the last printed time); (3) a 403 from `POST /devices/register` logs out (`POST /auth/logout`, token and session cleared) and the login page shows the server's message. A retired terminal's 401 also shows its own message ("This tablet has been retired.") instead of "Your session has ended".
- Proposal: confirm (1)–(3) as the intended behaviour, or, for (1)/(2), add `claimed_at` to the `PrintJob` resource and/or a small `GET /print-jobs/agent-status` (oldest `queued` job age and last claim time for the branch); the web would then switch to it.
- **Resolution (main, 2026-10-12):** (1)–(3) are confirmed as built. No API change: `claimed_at` and an agent-status endpoint stay out of Phase 8. §I is updated to match: printer health and the print-agent check use this terminal's own jobs, and checklist item 5 is "no job of this terminal has been `queued` for over 2 min".

### Q-043 [FRONTEND→BACKEND] Admin Devices: no single-device read for the detail screen — RESOLVED
- Raised by: frontend-agent · Feature: Hardening & Pilot (Phase 8) §C/§E · Endpoints: GET /api/v1/admin/devices, PATCH /api/v1/admin/devices/{id}
- Problem: §E asks for a device **detail** with the heartbeat fields, but §C defines no `GET /api/v1/admin/devices/{id}`. The tablet can only show a device it has in a loaded list page (or the `AdminDevice` returned by rename / retire / restore). A detail opened after the list cache is gone (app restart on that screen, a future deep link from the `device_unsynced` insight) has nothing to load.
- Built meanwhile (conservative): the detail route `/(app)/(admin)/devices/[id]` reads the device from the Devices list cache and the rename / retire / restore answers; with nothing cached it shows "Open this device from the Devices list." with Back. The `device_unsynced` insight opens the list, not a detail. No endpoint was invented.
- Proposal: add `GET /api/v1/admin/devices/{id}` → 200 `{ data: AdminDevice }` (`system.manage`, branch-scoped, retired devices included, 404 otherwise); the tablet would then load the detail from it.
- **Resolution (main, 2026-10-12):** accepted. §C now has `GET /api/v1/admin/devices/{id}` → 200 `{ data: AdminDevice }`. It needs `system.manage`, includes retired devices, and returns 404 for a device outside the branch (unless `branch.all`). backend-agent adds it. The tablet and the web load the device detail from it, seeded from the list cache.

### Q-044 [BACKEND→MAIN] Phase 8 backend: details §B/§C leave open, and how they were built — RESOLVED
- Raised by: backend-agent · Feature: Hardening & Pilot (Phase 8) §B/§C · Endpoints: POST /client-errors, GET /admin/error-log, POST /admin/devices/{id}/retire, GET /dashboard
- Problem and what was built meanwhile (each is the conservative reading; please confirm or correct):
  1. **`device_unsynced` with several tablets.** The contract words one tablet only. Built: **one** insight; `count` = the number of tablets; title "T02 has 5 unsynced sales (last seen 2 h ago)" for one tablet (`1 unsynced sale` singular; age rounded down as `N min` / `N h` / `N d ago`), "3 tablets have unsynced sales" for several; message "Bring these tablets online so their sales sync before anything is lost." Web terminals are never counted.
  2. **`health` and `errors_pending`.** §C lists `errors_pending > 0` only for web terminals ("only the last-seen rule and `errors_pending > 0` apply to them"). Built: `errors_pending > 0` → `attention` for tablets too. A device never seen is `offline`; "pending sales older than 30 min" = `oldest_pending_at` over 30 min ago (with `outbox_pending` > 0 or absent).
  3. **`meta.summary`.** Built over the groups the caller can see, ignoring the list filters: `open` (status open), `open_fatal` (open and fatal), `last_24h` (groups with `last_seen_at` in the last 24 h, any status).
  4. **Visibility details.** An app group is visible when it has an event in the caller's branch or with no branch (all groups with `branch.all`). `latest` and the detail's `events` use only the events the caller can see; `occurrences`, `app_versions` and the seen times stay group-wide. An invisible group is a 404.
  5. **`from` / `to`** on the error log are calendar days in the branch's timezone.
  6. **Repeated actions.** Retiring a retired device, restoring an active one, resolving a resolved group or reopening an open one answers 200 with the current state and writes no second audit entry. The 409 message says `1 unsynced sale` for one.
  7. **Rename vs re-registration.** `POST /devices/register` (Phase 5) still overwrites `name` with what the app sends, so an admin rename lasts until the tablet registers again (next login). Proposal: keep an existing device's name on register; not changed here, since it alters Phase 5.
  8. **`POST /client-errors` edge cases.** `occurred_at` before 2000 or more than a day ahead (an unset tablet clock) is stored as the receive time instead of rejecting the batch; group `first_seen_at` / `last_seen_at` follow `occurred_at`; `app_versions` is newest first; unknown context keys are dropped, `extra` keeps its first 20 scalar entries (keys max 60); a non-ULID `install_id` is a 422. A token of a deactivated user or a retired device is ignored (the error is recorded without user or device), never a 401, since auth is optional there.
  9. **5xx capture.** Recorded for any unhandled exception rendered with a 5xx, except a deliberate HTTP exception whose status isn't 500 (e.g. `abort(503)`). Message `Class: message`; a database error keeps only its SQLSTATE and the SQL with `?` placeholders (bound values may be input); the stack lists file:line and function per frame, never arguments; `context.extra` = `{ route, method, status }`; the event's branch is the user's.
- Proposal: confirm 1–9 (and decide 7). The answers would only change wording or a rule inside the server; no response shape changes.
- **Resolution (main, 2026-10-12):** 1–6, 8 and 9 are confirmed as built. **7: an existing device keeps its name on `POST /devices/register`.** `name` is only used when the device is created, so an admin rename lasts; `app_version` and `last_seen_at` are still updated. §C records this. No response shape changes.

### Q-045 [WEB→MAIN] Purchase Request & Order PDF: three readings of §C/§D/§G — RESOLVED
- Raised by: web-agent · Feature: Purchase Request & Order PDF (v1.24) §C, §D, §G · Endpoints: GET /purchase-requests, GET /purchase-requests/{ulid}, GET /purchase-orders/{ulid} (no change)
- Problem and what was built meanwhile:
  1. **"Needs my decision" view.** §G lists the PR filters to carry as "All / Mine, status, search", but the web list also has a **Needs my decision** view (`needs_decision=true`). Built: the print view carries it too (`?needs_decision=true`, "Requests: Needs my decision"), so the register always matches what the list shows.
  2. **NOT APPROVED band on a PR.** §C.6 says "when the status is not approved". Built literally: the band shows for every status except `approved`, including `partially_approved`, `declined` and `cancelled`.
  3. **PO status chips.** §D.1 says "a status chip with the receiving status". Built: two outline chips, the PO status and the receiving status, for every PO (pending and declined ones read "Not Received").
- Proposal: confirm 1–3, or say which to change. Web-only wording/visibility; no shape changes.

- **Resolution (main, 2026-10-12):** 1–3 are confirmed as built. (1 no longer applies: the register was removed the same day.) The register carried "Needs my decision", the NOT APPROVED band shows for every status except `approved`, and a PO shows both chips.

### Q-046 [BACKEND→MAIN] Dine-in Tables & Tabs (T1 + T2): details §A–§E leave open, and how they were built — RESOLVED
- Raised by: backend-agent · Feature: Dine-in Tables & Tabs (v1.26) · Endpoints: `PATCH /admin/settings`, `/admin/tables`, `/tables`, `/tabs/*`, `POST /orders/{ulid}/refunds`, `POST /print-jobs` (no shape changes)
- Problem and what was built meanwhile:
  1. **Settle quantity above `remaining_qty`.** §D.6 lists `qty ≤ remaining_qty` as a body rule but also says a quantity another device settled or cancelled first is a `409`. The server can't tell the two apart, so built: any quantity (summed per `tab_item_id` when a line is sent more than once) above `remaining_qty` is `409 "This bill changed on another device. Review it again."`, before pricing and again under the tab's lock. `items` omitted with nothing remaining is the same `409`. A `tab_item_id` not on the tab is `422` on `items.{i}.tab_item_id`: `This item isn't on this bill.` (no text in the contract).
  2. **Equal-split payment messages** (none in §E). Built: a GCash share that isn't exact → `422` on `payments.{i}.amount_cents`: `This GCash payment must be exactly ₱94.23.`; a cash share that's short → `422` on `payments.{i}.amount_cents`: `The payment is short by ₱4.23.` (the sale wording). Each cash share is stored with `amount_cents` = its share, `tendered_cents` = the amount sent and its own change.
  3. **Refund of `S` and the Phase 7 invariant.** The refund that leaves nothing refundable adds `S` to `amount_cents` (and so to `orders.refunded_cents`), outside its VAT split; no `refund_items` line carries it. So the Phase 7 invariant "`refunded_cents` = Σ items.refunded_cents" becomes "Σ items.refunded_cents + `S` when the order is `refunded`". The app's checksum (`client_refund_cents`) must include `S` on that last refund.
  4. **Merge.** Built: the moved quantity leaves the source line (its `qty` drops to `settled_qty + cancelled_qty`, so the merged source shows `remaining_qty` 0 and `remaining_cents` 0); the new target lines keep the snapshots, notes, `added_by` and `added_at`; `guests` are summed without a cap (they can exceed 99). A target that would pass 200 lines → `422` on `into_ulid`: `This bill has too many lines. Settle part of it first.`. `into_ulid` that isn't another open tab of the branch → `422` (`The selected into ulid is invalid.`); a merged/closed **source** → `409 "This bill is already closed."`.
  5. **`Close the N open bills first.`** is built literally, also for N = 1 (`Close the 1 open bills first.`). Say if N = 1 should read `Close the 1 open bill first.`.
  6. **Print jobs of tabs.** `kind: "bill"` was added; `order_ulid` stays required for it. Built nothing else: the first-print de-duplication on `(order_ulid, kind, printer_id, copy_no)` still applies, so the web client must send a **fresh ULID per print** as `order_ulid` for `bill`, and a per-round ULID (e.g. the round's `ulid`) for a round's `kitchen` ticket and per-cancel for `kitchen_void`; otherwise a second bill or round 2's ticket would be de-duplicated away. Please confirm, or define which ULID these jobs carry.
  7. **Audit payloads** (not defined): `tab.opened` `{ulid, table, guests}`; `tab.updated` `{field: {from, to}}` (added for PATCH); `tab.round_sent` `{round_no, items: [{product_id, qty}]}`; `tab.item_cancelled` `{tab_item_id, product_name, qty, reason, authorized_by}`; `tab.closed` `{status}`; `tab.transferred` `{from, to}` (table names); `tab.merged` `{into_ulid | from_ulid, items}`.
  8. **Data model additions:** `dining_tables.area_sort` (generated `COALESCE(area, '')`, as `customers.last_name_sort`) so the cursor lists can page past tables with no area; `tab_items.category_name` and `sku` snapshots (the settlement's order lines need them); `tab_item_cancellations.ulid` = the cancel request's `Idempotency-Key`. Tab settlements use the token's device, as `POST /orders`; no device is required.
- Proposal: confirm 1–8 as built, or say which to change.
- **Resolution (main session, 2026-10-13): RESOLVED.** 1–4 and 6–8 confirmed as built. 5: the count is pluralised: `Close the 1 open bill first.` for N = 1, `Close the N open bills first.` otherwise. 6: see Q-047 for split receipts.

### Q-047 [WEB→MAIN] Dine-in print jobs on web terminals: which `order_ulid` / `copy_no` the tab documents carry, and split receipts vs the first-print de-duplication — RESOLVED
- Raised by: web-agent · Feature: Dine-in Tables & Tabs (v1.26) §F, Web POS & Print Bridge §D · Endpoint: `POST /print-jobs` (no shape change)
- Problem and what was built meanwhile:
  1. **Round, cancel and bill jobs** (same reading as Q-046.6). Built: a round's `kitchen` tickets carry the **round's `ulid`** (its `Idempotency-Key`) as `order_ulid`; a cancel's `kitchen_void` tickets carry the **cancel's `Idempotency-Key`**; each **Print bill** (`kind: "bill"`) carries a **new ULID per print**, `copy_no` 1, `is_reprint: false`. `// TODO(Q-047)` in `web/src/printing/printActions.ts`.
  2. **Equal-split receipts.** §F prints one receipt per share (up to 10), all for the same order. The first-print de-duplication keys on `(order_ulid, kind, printer_id, copy_no)` and `copy_no` is 1–3, so shares 2…N of one order would be de-duplicated into share 1's job. Built meanwhile: share 1 is sent as a normal first print (`copy_no` 1); shares 2…N are sent with `copy_no` 1 and **`is_reprint: true`** only to skip the de-duplication (the printed bytes are not marked REPRINT). One receipt per share, so `receipt_copies` is not applied to split receipts.
  3. With auto-print off, **Print receipt** after a split prints all shares the same way.
- Proposal: either allow `copy_no` 1–10 (share `k` → `copy_no` k, `is_reprint: false`), or add an optional `share_no` to the print job and to the de-duplication key. Say which, and whether `receipt_copies` should repeat per share.
- **Resolution (main session, 2026-10-13): RESOLVED.** 1 confirmed as built. 2: `POST /print-jobs` accepts `copy_no` **1–10 for `kind: "receipt"`** (other kinds keep 1–3). Equal-split share `k` is sent as `copy_no = k`, `is_reprint: false`, so the existing de-duplication key keeps each share; remove the `is_reprint` stopgap. `receipt_copies` is not repeated per share (one receipt per share). 3 confirmed.

### Q-048 [FRONTEND→MAIN] Dine-in on the tablet: the receipt's service-charge rate, split receipts and the refund of `S` — RESOLVED
- Raised by: frontend-agent · Feature: Dine-in Tables & Tabs (v1.26) §E, §F, §G · Endpoints: none changed (`Order`, `POST /orders/{ulid}/refunds`)
- Problem and what was built meanwhile:
  1. **`Service charge (10%)` on a receipt.** `Order` has `service_charge_cents` but not the rate it was charged at, and a reprint may happen after the setting changed. Built: the receipt (and Order detail) prints the branch's **current** `service_charge_bps` only when `rhu((total − S) × bps, 10000) = S`; otherwise the row reads `Service charge` with no rate. `@pos/core` `buildReceipt` takes the rate as an option (`serviceChargeBps`).
  2. **Split receipts on the tablet** (the tablet's own queue, not the print-job API of Q-047): one receipt per share, share `k` stored as `copy_no = k` of `N` (the local de-duplication key allows it), with `receipt_copies` not repeated per share. With auto-print off, **Print receipt** prints every share; a reprint also prints every share.
  3. **Refund of `S`** (§E, as Q-046.3 reads it): `@pos/core` `priceRefund` gains an optional 5th argument `serviceChargeCents`; the refund that leaves nothing refundable adds `S` to `amount_cents` (and so to `client_refund_cents`), outside the VAT split, and returns it as `service_charge_cents`. The tablet passes `order.service_charge_cents`; the web refund screen must pass it too, or its last refund of a tab order fails the checksum.
  4. **Discounts on a tab settlement**: a round takes none (its line editor says "Discounts are given when the bill is paid."); Pay offers the order discount (with manager approval above the limit) and SC/PWD, not line discounts, so `items[].discount` is `null`. `items` is always sent (never omitted), so the checksum covers exactly what the cashier saw.
- Proposal: confirm 1–4, or say which to change (1 has an alternative: add `service_charge_bps` to `Order`).
- **Resolution (main session, 2026-10-13): RESOLVED.** 1–4 confirmed as built (no `service_charge_bps` on `Order`). 3: the web refund screen must pass `order.service_charge_cents` to `priceRefund` too.

### Q-049 [WEB→MAIN] Finished print job wording: "Sent" (contract) vs "Printed" (MASTER §6 toasts) — RESOLVED
- Raised by: web-agent · Feature: Printing → Screens (Sale complete, print status rows) and design-system/pos/MASTER.md §6 Toasts · Endpoints: none (`PrintJob.status = printed`)
- Problem: this contract says the app shows **"Sent", never "Printed"**, because port 9100 gives no confirmation. MASTER §6 lists a **"Printed"** toast, and the web restyle task asked to rename the finished-job row label from "Sent" to "Printed" to match the tablet. The tablet itself is split: its rows say "Sent" (`mobile/src/components/printing/PrintJobRows.tsx`), its toast says "Printed" (`mobile/src/printing/queue.ts`).
- Built meanwhile (web): the row keeps **"Sent"** and the one-time toast reads **"Sent: {document} to {printer}"**, following this contract.
- Proposal: keep "Sent" everywhere (rows and toasts) and change MASTER §6's toast list to "Sent to printer", or amend this contract to allow "Printed". The tablet and the web should then use the same word.
- **Resolution (main session, 2026-10-14): RESOLVED.** Keep **"Sent"** everywhere, as Printing → Screens says (port 9100 gives no confirmation). The web toast reads "Sent: {document} to {printer}"; the tablet's "Printed" toast changes to "Sent" too. The main session's round-3 instruction to use "Printed" was wrong and is withdrawn.

### Q-050 [WEB→MAIN] Dashboard Period Filter: wording of the other period-based sales cards — RESOLVED
- Raised by: web-agent · Feature: Dashboard Period Filter (v1.28) §C/§D · Endpoint: GET /api/v1/dashboard
- Problem: §D gives the period wording for the stat cards, the chart title and the chart's empty state only. The other sales cards (Top products, Payment methods, and the web's "Today's figures" breakdown card) are now computed over the period too (§C), but their old captions say "Today" ("Today, by quantity sold.", "Today's takings…", "No sales yet today."), which would be wrong for a past day, a month or a year.
- Built meanwhile (web, provisional): they follow the period label from the response (`Today` · `Tue, 14 Oct 2026` · `This month` · `October 2026` · `This year` · `2026`): Top products "{label}, by quantity sold.", Payment methods "{label}, takings net of change." (the stacked bar's row label is the period label), the figures card "Today's figures" on the running day and "Sales figures" / "{label}, sales that are not voided." otherwise. Their empty states keep "No sales yet today." / "No payments yet today." on the running day and use §D's `No sales on this day` · `in this month` · `in this year` otherwise. Day chart's description: "The 7 business days ending {today | Tue, 14 Oct 2026}, in pesos."
- Proposal: confirm this wording (or give another) so the tablet uses the same captions. No API change.
- **Resolution (main, 2026-10-14):** the web's provisional wording is adopted for **both** clients. On the running day the empty states keep `No sales yet today.` / `No payments yet today.` (this overrides §D's `No sales on this day` for the current day only); past days, months and years use §D's wording. Top products `{label}, by quantity sold.`, Payment methods `{label}, takings net of change.`, the Day chart description `The 7 business days ending {Today | date}, in pesos.` No API change.

### Q-051 [WEB→MAIN] Status board: "Upcoming reservations" needs `GET /reservations`, which `report.view` alone can't read — RESOLVED
- Raised by: web-agent · Feature: Table Management (v1.29) §D (Board) and §E · Endpoints: GET /api/v1/tables/summary, GET /api/v1/reservations
- Problem: the Board needs only `report.view` (§A), and §D asks it to list **today's booked reservations by time**. The only endpoint that returns them, `GET /reservations`, needs `sale.create` (§E). `TablesSummary` carries counts only (`reservations_today`). A manager with `report.view` but not `sale.create` would get a `403` there.
- Built meanwhile (web): the Upcoming reservations card shows only when the user also has `sale.create`; otherwise it is left out (MASTER: sections the user's permissions hide are left out, never shown empty). The stat cards and the table list are unaffected.
- Proposal: either let `GET /reservations` accept `sale.create` **or** `report.view` (read-only), or add today's booked reservations to `GET /tables/summary` (e.g. `upcoming: [{ ulid, guest_name, party_size, reserved_for, table: { id, name, area }, is_late }]`).
- **Resolution (main, 2026-10-26):** `GET /reservations` (list only) accepts `sale.create` **or** `report.view`. Every reservation mutation still needs `sale.create`. §E updated. Clients show the Board's Upcoming reservations card for `report.view`.

### Q-052 [WEB→BACKEND] Reservations: response body of update, cancel and no-show — RESOLVED
- Raised by: web-agent · Feature: Table Management (v1.29) §E.3–§E.5 · Endpoints: PATCH /api/v1/reservations/{ulid}, POST /api/v1/reservations/{ulid}/cancel, POST /api/v1/reservations/{ulid}/no-show
- Problem: §E gives create's response (`201 {data: Reservation}`) but not the status and body of update, cancel and no-show.
- Built meanwhile (web): the client assumes `200 {data: Reservation}` for all three (as the tab actions do) and only uses the reply to say the action worked; it then reloads the list, so another 2xx body would still work.
- Proposal: confirm `200 {data: Reservation}` (the updated reservation) for all three.
- **Resolution (main, 2026-10-26):** confirmed: update, cancel and no-show return `200 {data: Reservation}`, the updated reservation. §E updated.

### Q-053 [BACKEND→MAIN] Table Management (TM1/TM2): cases §B and §E leave open — RESOLVED
- Raised by: backend-agent · Feature: Table Management (v1.29) §B, §E · Endpoints: PUT /api/v1/admin/tables/layout, POST /api/v1/tabs, PATCH /api/v1/reservations/{ulid}, POST /api/v1/reservations/{ulid}/cancel, POST /api/v1/reservations/{ulid}/no-show, PATCH/DELETE /api/v1/admin/tables/{id}
- Built meanwhile (backend, provisional; none changes a documented shape):
  1. **Update, cancel and no-show responses** (same as Q-052): `200 {data: Reservation}`, the updated reservation.
  2. **`POST /tabs` with a `reservation_ulid` that isn't a reservation of the branch:** `422` on `reservation_ulid` (Laravel's `exists` message). A ULID that isn't well formed is also a `422` there.
  3. **Seating skips the hold check:** with `reservation_ulid`, the hold of *another* booked reservation on the same table is not checked (§E says the `409` applies "without `reservation_ulid`"). The occupied check (`Table 5 already has an open bill.`) still runs.
  4. **"Future booked reservations" in the table delete/deactivate guard:** booked reservations whose slot hasn't ended (`reserved_for + 120 min > now`), so a late guest still blocks, matching `GET /tables`' `reservation`. With one reservation the message is singular: `Table 5 has 1 upcoming reservation. Move or cancel it first.` (as `Close the 1 open bill first.`).
  5. **Layout `Table 5 isn't in this area.` for a table that isn't in the branch** (another branch's, deleted or unknown): the id sent is used as the name (`Table 123 isn't in this area.`), so another branch's table names never leak. Duplicate ids in `tables` get Laravel's `distinct` message on `tables.{i}.id`.
  6. **Layout overlap message:** each failing entry gets its own error; the other table named is the first overlapping one in the admin order (so two body tables that overlap each other get one error each).
  7. **Times in messages** (`7:00 PM`): the reservation time in the branch timezone, format `g:i A`, with no date.
  8. **Update clash check** runs on the final table and time on every update (excluding the reservation itself); the 15-minute/90-day window applies only when `reserved_for` is sent.
- Proposal: confirm 1–8 (or change any); no shape change is needed for any of them.
- **Resolution (main, 2026-10-26):** 1–8 confirmed as built. No shape change.

---

## Changelog
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-09-24 | Global conventions established; no features yet. |
| 0.2 | 2026-09-24 | Drafted Auth & Access Control (Phase 0). |
| 0.3 | 2026-09-24 | Auth & Access Control approved by the user as drafted. |
| 0.4 | 2026-09-24 | Auth revision 2 drafted: login takes `email` + `password` only; `device_code`/`app_version` removed; `AuthUser.device` removed; token named `mobile-app`, not device-bound, no revoke-on-login; bad credentials → `401 "Invalid email or password."`; deactivated → `403`. |
| 0.5 | 2026-09-24 | Auth revision 2 approved by the user. |
| 0.6 | 2026-09-24 | Drafted Catalogue: Categories & Products (Phase 1a). Global Conventions gain the admin CRUD pattern (201 / partial PATCH / soft-delete 204 / audit), multipart image uploads with absolute `image_url`, and `409` Conflict. |
| 0.7 | 2026-09-24 | Catalogue (Phase 1a) approved by the user: prices VAT-inclusive, cost hidden from cashiers, `track_stock` default false, 409 on deleting a non-empty category, local image disk in dev / S3-compatible in prod. |
| 0.8 | 2026-09-24 | Drafted Staff & Customers (Phase 1b): staff CRUD + password reset + PIN + roles list with a permission-subset hierarchy and self-protection 409s; `GET /admin/users` items gain `has_pin`/`can_manage` plus `role_id`/`is_active` filters; customers CRUD; new permission `customer.manage`. |
| 0.9 | 2026-09-24 | Staff & Customers (Phase 1b) approved by the user as drafted. |
| 1.0 | 2026-09-24 | Drafted Dashboard (Phase 1c): `GET /api/v1/dashboard` with permission-gated catalog/staff/customers/activity sections, reserved `sales: null`, server-built insights; margins and percentages in basis points; business-day buckets. Drafted Customers search revision 2 (phone matching only for phone-like terms). |
| 1.1 | 2026-09-24 | Dashboard (1c) and Customers search revision 2 approved by the user as drafted. |
| 1.2 | 2026-09-24 | Drafted Catalogue Sync (Phase 2): `GET /api/v1/sync/catalogue` (baseline and delta, tombstones, opaque cursor with a 5-second overlap, per-entity `limit` ≤ 500, no `cost_cents`), device apply rules, visibility rules matching the read endpoints, and a read-only Sell screen. PIN quick-switch moved from Phase 2 to Phase 3. |
| 1.3 | 2026-09-24 | Catalogue Sync (Phase 2) approved by the user as drafted. |
| 1.3.1 | 2026-09-24 | Catalogue Sync rule 4 wording fixed (Q-001): the restart point is capped by the run's first-page `server_time`, so a deletion during a paged baseline is never missed. Server-internal; no shape change. |
| 1.3.2 | 2026-09-24 | Catalogue Sync image prefetch is keyed by URL (Q-002). Device-side only. |
| 1.4 | 2026-09-25 | Drafted Core Sale (Phase 3): server-side sale pricing with worked examples (line + order discounts, largest-remainder allocation, per-order VAT), `POST /orders` (idempotent, online only, stock-blocking), `GET /orders` + `/orders/{ulid}`, PIN quick-switch (`GET /auth/pin-users`, `POST /auth/pin`), manager discount approval by PIN, stock adjustments + admin `stock_qty`, dashboard `sales` section. Global Conventions gain *Idempotent requests*. SC/PWD and shifts deferred. Q-002 resolution moved out of the template. |
| 1.5 | 2026-09-25 | Core Sale (Phase 3) approved by the user as drafted. |
| 1.5.1 | 2026-09-25 | Core Sale clarifications recorded from the implementation (branch-scoped idempotency keys, stale-key takeover after 60 s, the one-cash-payment message, error grouping, message formats). Q-003 resolved: the VAT rate is fixed at 1200 bps for v1. Q-004 resolved: on the "different request" 409 the app looks up `GET /orders/{ulid}`. No API shape change. |
| 1.6 | 2026-09-25 | Printing (Phase 4) drafted and approved by the user (as the Phase 4 plan): permission `settings.manage`; admin printers CRUD with category routes and a default kitchen printer; receipt settings; `GET /print-config`; `Order.items[].category_id` snapshot; device transport (local Expo Module), in-house ESC/POS (CP437), persistent print queue with lanes and safe retries, receipt and kitchen layouts. Pay-first, sales receipt (not an OR), no cash drawer. |
| 1.6.1 | 2026-09-26 | Printing clarifications recorded from the implementation (host-resolution errors retried like other connect errors; a 20 s write watchdog and a 45 s JS deadline; test and sample prints are not queued; "Print receipt" prints the configured copies once). Q-005 (auto-default also on a role change from cashier), Q-006 (kitchen lines in sale order) and Q-007 (manual kitchen reprint ignores `print_kitchen_tickets`) resolved. No shape change. |
| 1.7 | 2026-09-26 | Table Number (Core Sale revision 2): optional `table_no` on `POST /orders`, `Order` and `OrderSummary`; printed large on the kitchen ticket and shown on the receipt and in Orders. Requested and approved by the user. |
| 1.8 | 2026-09-26 | Offline Sales (Phase 5) drafted and approved by the user (as the Phase 5 plan): permission `order.review`; `POST /devices/register`; `POST /sync/orders` (per-order accepted/duplicate/rejected, never rejected for price/stock/checksum/payment; review flags); `GET /sync/stock`; `POST /orders/{ulid}/review`; Order gains `order_no`, `source`, `needs_review`, `review_reasons`, `reviewed_*`, `synced_at`; dashboard insight; device rules (online first, offline fallback, local numbering, outbox worker, offline printing, review UI). |
| 1.8.1 | 2026-09-26 | Offline Sales resolutions: Q-008 (ingest edge cases as implemented; an unexpected server error rejects one order only), Q-009 (insight wording), Q-010 (offline receipt prints `QUEUE T01-5`), Q-011 (no offline fallback when a manager approval was attached). No shape change. |
| 1.8.2 | 2026-09-26 | Offline hardening: server-reachability breaker (sales save offline instantly while the server is unreachable; `/up` probe every 15 s), request timeouts (orders 8 s, sync 30 s), all syncs re-run when the connection returns, and per-batch lookups on `POST /sync/orders`. No API shape change. |
| 1.9 | 2026-09-26 | Drafted Shifts & Reporting (Phase 6): one shift per tablet, offline-capable via the outbox; cash in/out; X-read/Z-read shift reports (device-computed, server authoritative); `shift_ulid` on orders; shift endpoints; sales reports by day/product/category/payment/cashier; CSV export. |
| 1.10 | 2026-09-26 | Shifts & Reporting (Phase 6) approved by the user as drafted. |
| 1.10.1 | 2026-09-27 | Shifts & Reporting resolutions: Q-012 (shift edge cases as implemented; a late close records its count on an auto-closed shift that has none), Q-013 (366-day inclusive range, `meta` always present, tie-break by label then key, CSV header and `TOTAL` line), Q-014 (X/Z-read print layout), Q-015 (the tablet's report counts every local sale of the shift), Q-016 (no `Idempotency-Key` on shift writes). No shape change. |
| 1.11 | 2026-09-27 | Drafted Voids & Refunds (Phase 7): void while the sale's shift is open (same tablet), refunds full or per line with no time limit, manager PIN approval, money back by the method paid, VOID kitchen ticket, void and refund slips; `Refund` object; order status `voided`/`refunded`/`partially_refunded`; refunds counted on their own day and shift in every sales figure. |
| 1.12 | 2026-09-27 | Voids & Refunds (Phase 7) approved by the user as drafted. |
| 1.12.1 | 2026-09-27 | Voids & Refunds resolutions: Q-017 (tablet wording and print details as implemented), Q-018 (check order, stock returned only where the sale took it, payment-method messages, refund ULID reuse; visibility unchanged), Q-019 (CSV `TOTAL` refunded units, refund-only cashier rows, `refunded_qty` 0 on product/category rows, row labels). No shape change. |
| 1.13 | 2026-09-27 | Inventory (v1 completion) approved by the user (plan approval): stock list with derived status and a per-product reorder level; movement history with running balance; stock in / count / wastage movement types; inventory report and CSV; `stock_out` / `stock_low` insights; Low/Out badges on Sell tiles via `/sync/stock` `reorder_level`. |
| 1.13.1 | 2026-09-27 | Inventory resolutions: Q-020 (adds `GET /inventory/{product}`), Q-021 (`created_by` and `unit_cost_cents` nullable on history items), Q-022 (insight messages, reorder-level audit wording, flow totals over every matching product when truncated, type-rule details). |
| 1.14 | 2026-09-28 | Drafted Senior Citizen / PWD Discount: cashier-applied (no PIN, works offline), `items` or `headcount` mode, no double discount, ID number only; VAT relief + 20% pricing with worked examples D and E; refund VAT split with SC/PWD; SC/PWD figures in shift, sales and dashboard reports; receipt lines. |
| 1.15 | 2026-09-28 | Senior Citizen / PWD Discount approved by the user, with VAT exemption optional per sale (`sc_pwd.vat_exempt`, unticked by default in the app); worked example F added. |
| 1.15.1 | 2026-09-28 | SC/PWD resolutions: Q-023 (tablet print and cart details as implemented), Q-024 (refund taxable part clamped to the line refund amount; validation details; report indexes extended). No shape change. |
| 1.16 | 2026-09-28 | Drafted Ingredients, Recipes & Purchasing: exact unit catalog + per-ingredient units to one base unit (examples G–J); ingredient stock with value and weighted-average cost; suppliers; PR per-item decisions → one PO per PR (per-line suppliers); PO approval; append-only receiving with Over-received; owner self-approval; purchasing report; product stock modes (own/recipe/none), recipes with ingredient or own-product components, depletion on sale (never blocks), void returns, refund wastage. |
| 1.17 | 2026-09-28 | Ingredients, Recipes & Purchasing approved by the user as drafted. |
| 1.17.1 | 2026-09-29 | Ingredients & Purchasing Round A resolutions: Q-025 (`base_unit_locked`, `image_path` on `Ingredient`), Q-026 (movement/adjustment shapes, `reference.kind: purchase_order`), Q-027 (product quantities stay integers; timeline details strings), Q-028 (report shapes), Q-029 (insight keys), Q-030 (correction avg-cost, receipt cost exact factor, totals over approved POs). No shape change beyond these. |
| 1.17.2 | 2026-09-29 | Recipes Round B resolutions: Q-031 (`stock_mode` on every `Product`, `track_stock` still accepted with `stock_mode` winning, `Recipe` shape with integer product quantities, `margin_bps` truncated and null at price or cost 0, 409 on a non-recipe PUT/apply-cost, 422 messages, refund waste as a `wastage` history entry with `reference.kind: refund`), Q-032 (`refund_item_components` table, refund waste on the refund's day, all-branch switching rule, component rules; **a void re-weights `avg_cost` at the snapshot cost like a receipt**, amending §B). |
| 1.18 | 2026-09-29 | Drafted Ingredient **Set cost** (§D1): `POST /admin/ingredients/{id}/cost` (`inventory.adjust`, idempotent, cost per any valid unit), a new `revaluation` movement that keeps value reconciling, audit `ingredient.cost_set`, and a Set cost action in the app. |
| 1.19 | 2026-09-29 | Ingredient Set cost (§D1) approved by the user as drafted. |
| 1.19.1 | 2026-09-29 | Set cost resolution: Q-033 (route `v1.admin.ingredients.cost.store`; revaluation value counts in the report's `value_in_cents`/`value_out_cents`; the "too small" guard kept). No shape change. |
| 1.20 | 2026-09-30 | Drafted Hardening & Pilot (Phase 8): `system.manage`; built-in error log (`POST /client-errors`, server 5xx capture, admin groups with resolve/reopen); device heartbeat, retire/restore, admin devices, `GET /app-version` with min/latest version gating; one EAS `production` profile (APK, internal distribution, channel `production`); tablet setup & health screen; app error capture; soak tests; staff guides and pilot runbook. |
| 1.20.1 | 2026-09-30 | The purchase request item picker and the recipe component picker show active ingredients only (app change; API unchanged). |
| 1.20.2 | 2026-09-30 | `purchase.approve` is owner-only: only the Owner decides PR items and approves or declines POs (user decision). Seeder change; re-run `RolesAndPermissionsSeeder`. No shape change. |
| 1.20.3 | 2026-10-01 | VAT display hidden in the app and on the printed receipt and refund slip (app flag `SHOW_VAT_BREAKDOWN = false`) until BIR accreditation: the receipt is a temporary internal receipt. The server still computes and stores every VAT field, and the SC/PWD "VAT exempted" deduction still shows. No API change. |
| 1.20.4 | 2026-10-07 | Every database table is prefixed `tbl_` through the connection prefix (user decision; one database for mobile and the upcoming web POS). Storage-only change: no endpoint, field, or validation message changes. Dev database rebuilt with `migrate:fresh --seed`. |
| 1.21 | 2026-10-07 | Drafted Web POS & Print Bridge: `web/` served same-origin at `/pos` (no CORS); `devices.platform` with `W` codes for web terminals; `print_jobs` queue (`POST/GET /print-jobs`, retry) with client-built ESC/POS bytes; token-protected print-agent endpoints (ping, claim with `SKIP LOCKED`, result) and `print-agent:run` / `print-jobs:prune` commands; web client rules; build rounds W1–W5. |
| 1.21.1 | 2026-10-08 | Web POS & Print Bridge **approved** by the user. W1 gains the open-shift gate (a sale needs an open shift). |
| 1.21.2 | 2026-10-08 | Q-034 resolved: cross-branch ULID → 422, invalid base64 → 422, `last_error` rules, skipped jobs reported as retryable failures, only connect errors retry, extra index `(branch_id, order_ulid)`; a stale job with ≥ 3 attempts fails at claim ("The print agent stopped responding."). |
| 1.21.3 | 2026-10-08 | Q-035–Q-038 resolved: new `GET /shifts/current` (token device's open shift or null); web may read `GET /sync/stock` for badges; `kind: "test"` covers receipt samples; same-origin `/storage/` images plus optional `VITE_IMAGE_ORIGIN`. |
| 1.21.4 | 2026-10-09 | Repo structure: the rules and printed documents both clients use moved to `packages/pos-core` (`@pos/core`), linked into `mobile/` and `web/`; contract types live in `packages/pos-core/src/contract/types.ts`. No API change. |
| 1.21.5 | 2026-10-09 | Web round W2 (shifts, voids and refunds, Needs review) built on existing endpoints; no API change. Q-039 resolved: the review reason `shift_closed` gets a plain-words label in `@pos/core`. The refund formula, the reversal gates and the review wording moved from `mobile/` to `packages/pos-core/src/sale/`. |
| 1.21.6 | 2026-10-09 | Web round W3 (categories, products and images, recipes, staff and roles, customers) built on existing endpoints; no API change. Q-040 resolved: the seeded permission descriptions are shared in `@pos/core/permissions`. `quantity`, `units` and `recipe` moved from `mobile/src/utils/` to `packages/pos-core/src/`. |
| 1.21.7 | 2026-10-09 | Web round W4 (product and ingredient inventory, set cost, units read-only, suppliers, purchase requests, purchase orders, receiving) built on existing endpoints; no API change, no Open Questions. |
| 1.21.8 | 2026-10-09 | Web round W5 (dashboard with Recharts charts and insight links; sales, inventory and purchasing reports with CSV export) built on existing endpoints; no API change. Q-041 resolved (the dashboard trend is the last 7 days; the design spec was updated). `numbers` moved from `mobile/src/utils/` to `packages/pos-core/src/`. All Web POS rounds W1–W5 are built. |
| 1.23 | 2026-10-12 | Hardening & Pilot (Phase 8) draft revised for the Web POS: web terminals get error capture, heartbeat and a "This terminal" page (§I); admin devices gain `platform` (filter + item) and web health rules; the admin Devices and Error log screens are built on both the tablet and the web; shared `@pos/core/errors`; version gating stays tablet-only; runbook covers the web build and print agent; one build round (§J). |
| 1.24 | 2026-10-12 | Purchase Request & Order PDF (web only, no API change): Print / PDF of one request or order (A4 portrait, all items, signature lines, per-supplier PO copy) from a print button on each list row and on the detail page. The whole-list printout was dropped at the user's request. |
| 1.26 | 2026-10-13 | Drafted Dine-in Tables & Tabs (optional, off by default): `dine_in_enabled` + `service_charge_bps` settings; admin tables; `GET /tables`; server-side tabs with kitchen rounds, sent-item cancel (void authority), settle into normal orders (snapshot prices, no stock block), close, transfer, merge; split by item or equally; service charge; bill printout; `Order` gains `tab_ulid`, `service_charge_cents`, `split_count`. |
| 1.26.1 | 2026-10-13 | Dine-in Tables & Tabs **approved** by the user as drafted. |
| 1.26.2 | 2026-10-13 | Q-046–Q-048 resolved: `Close the 1 open bill first.` pluralisation; receipt print jobs accept `copy_no` 1–10 (equal-split share `k` = `copy_no k`); the refund that empties a tab order returns `S` (in `client_refund_cents`); receipts show the current service-charge rate only when it reproduces `S`. |
| 1.27 | 2026-10-13 | Drafted Purchase Request & Order PDF revision 2 (tablet): `expo-print` (new Dev Client build); PDF buttons on PR/PO/Receiving detail, PO row keeps Open plus PDF; print model moves to `@pos/core/purchasing/printModel`, HTML document in `@pos/core/purchasing/printHtml`; preview with Print/Save as PDF and Share; online only. |
| 1.27.1 | 2026-10-13 | Purchase Request & Order PDF revision 2 (tablet) **approved** by the user as drafted. |
| 1.27.2 | 2026-10-14 | Q-049 resolved: print jobs and their toasts say "Sent", never "Printed", on both clients (no API change). |
| 1.28 | 2026-10-14 | Drafted Dashboard Period Filter: `GET /dashboard` takes `period` (day/month/year) and `date`; the `sales` section is computed over the period and gains `period`, `date_from`, `date_to` and `trend` (day or month buckets); `last_7_days` kept for older builds; Day · Month · Year filter with a date stepper on both clients. |
| 1.28.1 | 2026-10-14 | Dashboard Period Filter **approved** by the user as drafted. |
| 1.28.2 | 2026-10-14 | Q-050 resolved: period wording of the other dashboard sales cards (web wording adopted on both clients; running day keeps "No sales yet today."). No API change. |
| 1.29 | 2026-10-26 | Table Management **approved** by the user as drafted: Tables page always in the menu (Board, Reservations, Floor plan, List); `DiningTable`/`TableView` gain the plan fields; `PUT /admin/tables/layout`; `GET /tables/summary`; `TabSummary.last_round_at`; reservations with a table hold (`reservation_hold_minutes`) and seating through `POST /tabs` `reservation_ulid`. |
| 1.29.1 | 2026-10-26 | Q-051–Q-053 resolved: `GET /reservations` also readable with `report.view`; update/cancel/no-show return `200 {data: Reservation}`; backend edge cases confirmed. |
| 1.29.2 | 2026-10-26 | Web "This terminal" page (Hardening §I) removed at the user's request. The heartbeat, error capture and receipt printer choice are unchanged. No API change. |
