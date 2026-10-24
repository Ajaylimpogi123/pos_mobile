import type { AppVersionInfo } from '../contract/types';

/**
 * Hardening & Pilot §C/§D: versions are compared as semver `major.minor.patch`.
 * A leading `v` and any pre-release or build suffix are ignored; missing parts are 0.
 */

export type SemVer = readonly [major: number, minor: number, patch: number];

/** `'1.2.3'` → `[1, 2, 3]`; `'1.2'` → `[1, 2, 0]`; anything unparseable → `null`. */
export function parseVersion(version: string | null | undefined): SemVer | null {
  if (typeof version !== 'string') return null;
  const match = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?\s*$/i.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * -1 when `a < b`, 0 when equal, 1 when `a > b`; `null` when either is unparseable
 * (callers then never gate on it).
 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** §D outcome of the version check. */
export type VersionStatus = 'update_required' | 'update_available' | 'up_to_date';

/**
 * Below `min_version` → `update_required`; below `latest_version` → `update_available`;
 * otherwise (or when a version can't be parsed) `up_to_date`. Never blocks on bad data.
 */
export function versionStatus(current: string | null | undefined, info: AppVersionInfo): VersionStatus {
  if (compareVersions(current, info.min_version) === -1) return 'update_required';
  if (compareVersions(current, info.latest_version) === -1) return 'update_available';
  return 'up_to_date';
}
