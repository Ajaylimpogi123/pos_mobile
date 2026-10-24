# @pos/core

These are the POS rules shared by the **tablet app** (`mobile/`) and the **web POS** (`web/`). They exist once, so the tablet and the browser can never price, discount or print a sale differently.

## What lives here

| Path | What |
|---|---|
| `src/contract/types.ts` | Every request and response shape in `docs/api-contract.md`, field for field. Each app's `src/services/types.ts` re-exports it. |
| `src/money.ts` | Integer-centavo helpers (parse and format). Money is never a float. |
| `src/businessDay.ts` | The branch business day and wall clock (timezone plus day start). |
| `src/permissions.ts` | Permission slugs and `hasPermission` (UI hints; the server enforces). |
| `src/features.ts` | Display flags, e.g. `showVatBreakdown()`. |
| `src/sale/` | `pricing`, `discountRules`, `scPwd`, `payments`, `table`, `order` (the `POST /orders` body), `orderNumbers`, the shared `cart` types, `refunds` (the refund amount formula and the `POST /refunds` body), `reversals` (void and refund gates, status labels), `reviewReasons` (Needs review wording), and for Dine-in Tables & Tabs `serviceCharge` (`computeServiceCharge`, `equalSplitShares`) and `tab` (`tabRemainingLines`, `priceTabSettlement`, `buildTabRoundRequest`, `buildTabSettleRequest`). |
| `src/numbers.ts` | Counts with thousands separators and basis-point percentages (integer maths, no floats). |
| `src/quantity.ts`, `src/units.ts`, `src/recipe.ts` | Exact decimal quantities (`BigInt`, never floats), unit choices and conversion, and the recipe cost and margin preview. |
| `src/shifts/cashRefunds.ts` | The cash-refund figure of a shift report. |
| `src/printing/` | The ESC/POS builder (`escpos/`), the printed documents (`documents/`: receipt, kitchen ticket, void and refund slips, X/Z-read, test page; for dine-in the bill, the round kitchen ticket `buildTabRoundTicket` and the tab kitchen void `buildTabKitchenVoid`) and printer routing (`routeTicketLines` for any lines with a `category_id`). |
| `src/purchasing/` | Purchase Request & Order PDF (v1.24, v1.27 §G). `printModel`: the document rules (`itemEstimateCents`, `prEstimateTotals`, `commonApprover`, `groupLinesBySupplier`, `selectSupplierGroups`, `parseSupplierParam`, `showReceivedColumns`, `poDate`, `printErrorProps`, `printFooterText`, the §E messages). `printHtml`: the complete A4 HTML of one PR or PO (inline CSS, escaped values, `@page` footer, repeated `thead`, optional supplier filter) that the tablet prints with `expo-print`, plus `buildPrintContext` and `printFileName`. |
| `src/errors/` | Hardening & Pilot (Phase 8) error and device rules: `redact` (`redactText`, `redactClientError`, `redactContext`, `redactExtra`, `stripQueryString`, `isSensitiveKey`, `ERROR_LIMITS`), `fingerprint` (`normaliseMessage`, `topStackFrame`, `localFingerprint`, `createErrorDeduper`, `DEDUPE_WINDOW_MS`), `version` (`parseVersion`, `compareVersions`, `versionStatus`) and `health` (`DEVICE_HEALTH_LABELS` / `_DESCRIPTIONS` / `_TONES`, `DEVICE_PLATFORM_LABELS`, `ERROR_LEVEL_LABELS`, `ERROR_SOURCE_LABELS`, `ERROR_STATUS_LABELS`, `unsyncedSalesLabel`). Import as `@pos/core/errors/redact` etc. Redact **before** queueing. |

**What stays in each app:** anything that touches a platform:
- React and React Native components, stores (zustand), hooks
- storage (SQLite, SecureStore, localStorage), HTTP (`src/services/api.ts`)
- print transport (TCP on the tablet, the print-job queue on web)
- the tablet's offline orders (`mobile/src/sale/localOrder.ts`)

## Rules

1. **Platform-free TypeScript only.** No React, React Native, Expo, DOM, Node APIs, storage or network.
2. **No dependencies and no app imports.** Imports inside the package are relative (`../money`), never `@/…`.
3. **Imports from the apps:** `@pos/core/<path>`, for example `import { formatPeso } from '@pos/core/money'`. Each folder maps to `src/<path>.ts` through `exports`.
4. **Contract types change only with the contract.** When `docs/api-contract.md` adds or changes a shape, the main session updates `src/contract/types.ts` when the feature is approved, before the build agents start. Agents treat it as read-only and raise an Open Question instead.
5. **One editor per round.** Shared logic (pricing, discounts, SC/PWD, documents…) is changed by the agent the main session names in the task, and never by `frontend-agent` and `web-agent` in parallel.
6. **Every change must keep both apps green.** Run `npm run check` at the repo root. That is a standalone type check of this package, mobile's type check, lint and Jest (the package's unit tests live in `mobile/src/**/__tests__` and import from `@pos/core`), plus web's lint and build.

## How the apps link it

Each app has `"@pos/core": "file:../packages/pos-core"`, which npm turns into a symlink in its own `node_modules`. It is **not** an npm workspace on purpose. Expo pins React 19.2 and the web uses 19.3, and one shared install could give Metro two copies of React, which the Expo docs warn about.

The link needs these settings:
- **Metro (`mobile/metro.config.js`):** `watchFolders` includes this folder, and `resolver.nodeModulesPaths` includes `mobile/node_modules` (for the Babel helpers injected into these files).
- **Jest (`mobile/package.json`):** `moduleDirectories` includes `<rootDir>/node_modules`, for the same reason.
- **Vite (`web/vite.config.ts`):** `server.fs.allow` includes this folder.

After cloning, run `npm run install:all` at the repo root.
