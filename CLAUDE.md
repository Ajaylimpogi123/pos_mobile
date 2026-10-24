# POS Mobile: Claude conventions

Restaurant POS rebuild:
- a **Laravel REST API** (repo root)
- a **React Native / Expo Router tablet app** (`mobile/`)
- a **web POS and back-office** (`web/`, Vite + React)
- a **shared TypeScript package** (`packages/pos-core/`) used by both clients

## Sources of truth

| File                                                   | Role                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_MEMORY.md`                                    | Business rules, schema design, architecture, and roadmap. Read the relevant sections before any feature work.                                           |
| `docs/api-contract.md`                                 | The API contract between backend and frontend. The main session edits it; agents only append Open Questions. Wins over PROJECT_MEMORY.md on API shapes. |
| `.claude/agents/backend-agent.md`, `frontend-agent.md`, `web-agent.md` | The three build agents and their rules. |
| `design-system/pos/MASTER.md` (+ `pages/`) | The approved visual spec for the tablet and the web. |
| `packages/pos-core/README.md` | What is shared between the tablet and the web, and the rules for changing it. |

## Layout

- **Backend (repo root):** `app/`, `bootstrap/`, `config/`, `database/`, `routes/api.php`, `tests/`
    - Controllers: `app/Http/Controllers/Api/V1/` · Business logic: `app/Actions/<Domain>/` · Validation: `app/Http/Requests/` · Responses: `app/Http/Resources/` · Authorization: `app/Policies/`
- **Mobile (`mobile/`, Expo SDK 57, TypeScript strict):** code lives under `mobile/src/` (the SDK 57 convention; `@/` aliases `src/`):
    - `src/app/` (Expo Router: routes and layouts only)
    - `src/components/`, `src/hooks/`
    - `src/services/` (the only place HTTP happens; `src/services/api.ts` is the shared client)
    - `src/components/ui/` (generic primitives: Button, Input, Card, ...)
    - `src/constants/` (`theme.ts`), `src/stores/`, `src/utils/`
    - `src/hooks/useResponsive.ts`: the single source of layout decisions. The tablet is the primary device; every screen auto-adjusts to phones and both orientations (`"orientation": "default"`).
    - `mobile/AGENTS.md` (Expo's own guidance: check the versioned SDK docs, never trust memory) also applies.
- **Web (`web/`, Vite + React 19, TypeScript strict, shadcn/ui):** code lives under `web/src/` (`@/` aliases `src/`), with the same split as mobile (`routes/`, `components/`, `hooks/`, `services/`, `stores/`). It builds to `public/pos/` and Laravel serves it at `/pos` (same origin, no CORS).
- **Shared (`packages/pos-core/`, `@pos/core`):** platform-free TypeScript used by both clients:
    - contract types (`src/contract/types.ts`)
    - money, business day, permissions
    - sale rules: pricing, discounts, SC/PWD, payments, the order body, order numbers
    - the ESC/POS printed documents and routing

  Apps import it as `@pos/core/<path>`. It is linked with `file:` (not an npm workspace: Expo and the web use different React versions). Its rules are in its README.
- **Repo root `package.json`:** a task runner only:
    - `npm run dev` (web dev server; also started by `composer dev`)
    - `npm run build` (web build)
    - `npm run install:all`
    - `npm run check` (mobile + web checks)
- **Design and docs:** `design-system/pos/` (visual spec), `docs/api-contract.md`, `PROJECT_MEMORY.md`.

## Versions

Laravel **13** · Sanctum 4 · Pest 4 · Expo SDK **57** · React Native 0.86 · React 19.2 · TypeScript 6

## Environment (Windows, Laragon)

- PHP **8.4.23**: `C:\laragon\bin\php\php-8.4` (first on PATH; Herd Lite's PHP must not be used)
- MySQL **8.4.11**: Laragon, `127.0.0.1:3306`, user `root`
    - Dev database: `pos_mobile`
    - Test database: `pos_mobile_test`. Tests **only** ever run against this.
- Node **24 LTS** via nvm4w · Composer 2.9 · JDK 17 · Android SDK present · EAS CLI
- The phone/tablet reaches the API through the PC's LAN IP (`php artisan serve --host=0.0.0.0 --port=8000`). Never through `localhost`.

## Non-negotiable conventions (details in PROJECT_MEMORY.md)

- Money is **integer centavos** (`_cents`) in the DB, the API, and the app. No floats.
- The server recomputes all money. Client totals are only a checksum.
- Authorization is enforced server-side by Policies on every mutation. Permissions are data (slugs).
- `branch_id` always comes from the authenticated user, never from request input.
- Login is email + password only. Staff never type a device code (device identity will be registered silently in the offline phase).
- Transactional rows carry a client-generated `ulid` (the idempotency key). Orders are never deleted.
- Lists are cursor-paginated with a hard cap of 100.

## Workflow for every feature task

1. **Plan:** the main session reads the relevant code, drafts the feature section in `docs/api-contract.md`, shows it to the user, and **waits for approval**. No code is written before approval.
2. **Shared types:** after approval, the main session adds or changes the feature's shapes in `packages/pos-core/src/contract/types.ts`, so both clients start from the same types. If shared rules (pricing, discounts, documents…) must change, the main session names **one** agent in the task to change them in `packages/pos-core/`.
3. **Build in parallel:** launch `backend-agent` plus the client agent(s) the feature needs, all at the same time and working from the approved contract:
    - `frontend-agent` for `mobile/`
    - `web-agent` for `web/`
4. **Sync:** read Open Questions. Resolve each by updating the contract (marking it `RESOLVED`), then send the affected agent back. Repeat until none are open.
5. **Verify:**
    - every field a client reads exists in the API Resource
    - every endpoint a client calls exists in `routes/api.php`
    - every form field matches a validation rule
    - 401 and 422 are handled
    - then run `php artisan test` and `npm run check` (repo root: mobile type check, lint and Jest, plus web lint and build)
    - run `npx expo-doctor` in `mobile/` when mobile dependencies changed
6. **Report:**
    - changes per agent and files touched
    - flags for migrations, new `.env` values and new packages
    - for Expo packages, whether a new Dev Client build is needed

## Output rules

- Deliver complete files, never partial snippets.
- **Never commit or push.** The user reviews first.

## Token Efficiency

- Keep context focused on the current task.
- Avoid unnecessary explanations and repeated file reads.
- Inspect only relevant files.
- Use compact summaries when context becomes large.
- Make the smallest safe change.
- Keep responses concise.

## Speed & Token Efficiency

- Work immediately once requirements are clear.
- Avoid full-project scans and repeated analysis.
- Make the smallest safe change.
- Run targeted validation only.
- Avoid unnecessary refactoring.
- Prioritize: correctness → completion → efficiency.
