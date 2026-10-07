# POS Mobile: Claude conventions

Restaurant POS rebuild: a **Laravel REST API** (repo root) and a **React Native / Expo Router app** (`mobile/`).

## Sources of truth

| File                                                   | Role                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_MEMORY.md`                                    | Business rules, schema design, architecture, and roadmap. Read the relevant sections before any feature work.                                           |
| `docs/api-contract.md`                                 | The API contract between backend and frontend. The main session edits it; agents only append Open Questions. Wins over PROJECT_MEMORY.md on API shapes. |
| `.claude/agents/backend-agent.md`, `frontend-agent.md` | The two build agents and their rules.                                                                                                                   |

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
2. **Build in parallel:** launch `backend-agent` and `frontend-agent` at the same time, both working from the approved contract.
3. **Sync:** read Open Questions. Resolve each by updating the contract (marking it `RESOLVED`), then send the affected agent back. Repeat until none are open.
4. **Verify:**
    - every field the app reads exists in the API Resource
    - every endpoint the app calls exists in `routes/api.php`
    - every form field matches a validation rule
    - 401 and 422 are handled
    - then run `php artisan test`, plus `npx expo lint`, `npx tsc --noEmit`, and `npx expo-doctor` in `mobile/`
5. **Report:** changes per agent, files touched, and flags for migrations, new `.env` values, and new Expo packages (and whether a new Dev Client build is needed).

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
