# API Contract

**Single source of truth** between `backend-agent` (Laravel API) and `frontend-agent` (Expo app in `mobile/`).

- The **main session** drafts and edits this file. The user approves each feature section before any code is written.
- Agents may only **append** to [Open Questions](#open-questions). Everything else is read-only to them.
- Where this contract and `PROJECT_MEMORY.md` disagree on an API shape, **this contract wins**. Raise an Open Question if the disagreement looks unintended.

| Contract version | Last updated | Approved features |
|---|---|---|
| 0.3 | 2026-09-24 | Auth & Access Control (Phase 0) |

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
| `401` | Missing, invalid, or expired token | `{ "message": "Unauthenticated." }` |
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
- **401**: clear the token and go to login.
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
Status: **APPROVED** (2026-09-24)

Staff log in on a registered tablet with email + password + the device's code, and receive a Sanctum token bound to that device. The app uses `/auth/me` to learn who is logged in and what they may do. `permissions[]` is **only a UI hint**: the server enforces every permission itself.

*Deferred:* PIN quick-switch (`POST /api/v1/auth/pin`) moves to Phase 2, because it needs the device to sync the branch's user list first.

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
  "device": {
    "id": 1,
    "code": "TAB01",
    "name": "Counter Tablet 1"
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
| `device.id` | integer | no | The device the current token is bound to |
| `device.code` | string | no | Used later in `order_no` |
| `device.name` | string | no | |
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
| `device_code` | string | yes | `required`, `string`, `max:20` | The tablet's registered code, e.g. `TAB01`. Case-insensitive. |
| `app_version` | string | no | `nullable`, `string`, `max:20` | e.g. `1.0.0`; stored on the device record |

Checks run in this order. Each failure is a `422`, and the first failure wins:
| Check | Field | Message |
|---|---|---|
| Field validation fails | *(per field)* | Laravel default messages |
| Email not found, or wrong password | `email` | `These credentials do not match our records.` |
| User is deactivated (the password was correct) | `email` | `This account has been deactivated.` |
| `device_code` unknown or device deactivated | `device_code` | `This device is not registered.` |
| Device belongs to a different branch than the user | `device_code` | `This device is not registered to your branch.` |

**On success**, the server:
- issues a new token bound to the device, expiring after `AUTH_TOKEN_TTL_HOURS` (default **24**)
- revokes any older tokens for the same user on the same device
- sets `users.last_login_at`, `devices.last_seen_at` and `devices.app_version`
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

**Errors:** `422` (see the table above) · `429` `{ "message": "Too Many Attempts." }`

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

**Errors:** `401`. This covers a missing, invalid, expired or revoked token, **and** a token belonging to a user or device that was deactivated after login. The server revokes such a token.

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
| Device | `TAB01`, "Counter Tablet 1", branch `MAIN` |
| Users (password `password`) | `owner@pos.test` (Owner) · `manager@pos.test` (Manager) · `cashier@pos.test` (Cashier) · `inactive@pos.test` (Cashier, deactivated) |

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

*No open questions.*

---

## Changelog
| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-09-24 | Global conventions established; no features yet. |
| 0.2 | 2026-09-24 | Drafted Auth & Access Control (Phase 0). |
| 0.3 | 2026-09-24 | Auth & Access Control approved by the user as drafted. |
