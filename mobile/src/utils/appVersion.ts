import Constants from 'expo-constants';

/** Contract: `app_version` max 20. */
export const APP_VERSION_MAX = 20;

/**
 * The app version: `expo.version` in app.json (Hardening & Pilot §D: the semver
 * sent as `app_version`), read with expo-constants. `null` when unavailable.
 */
export function appVersion(): string | null {
  const version = Constants.expoConfig?.version?.trim();
  return version ? version.slice(0, APP_VERSION_MAX) : null;
}
