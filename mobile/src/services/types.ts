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

export type AuthUserDevice = {
  id: number;
  code: string;
  name: string;
};

/** Shared object returned by `login` (inside `data.user`) and by `me` (as `data`). */
export type AuthUser = {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
  last_login_at: IsoDateTime | null;
  role: AuthUserRole;
  branch: AuthUserBranch;
  device: AuthUserDevice;
  /** Permission slugs, sorted A→Z, no duplicates. May be empty. UI hint only. */
  permissions: string[];
};

/** POST /api/v1/auth/login body. */
export type LoginRequest = {
  email: string;
  password: string;
  device_code: string;
  app_version?: string | null;
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
