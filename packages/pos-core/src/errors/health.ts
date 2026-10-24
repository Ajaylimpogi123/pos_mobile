import type { DevicePlatform, DeviceHealth, ErrorLevel, ErrorGroupStatus, ErrorSource } from '../contract/types';

/**
 * Hardening & Pilot §C/§E display wording, so the tablet and the web show the
 * same words. The server derives `health`; the apps only label it.
 */

/** The chip label for a device's `health`. */
export const DEVICE_HEALTH_LABELS: Record<DeviceHealth, string> = {
  ok: 'OK',
  attention: 'Needs attention',
  offline: 'Offline',
  retired: 'Retired',
};

/** One sentence explaining the state (detail screens, accessibility). */
export const DEVICE_HEALTH_DESCRIPTIONS: Record<DeviceHealth, string> = {
  ok: 'Online and syncing normally.',
  attention: 'Has failed or old unsynced sales, error reports waiting, an outdated app, or low storage.',
  offline: 'Not seen in the last 30 minutes.',
  retired: 'Retired. Staff can’t sign in on it until it is restored.',
};

/** A platform-neutral tone each app maps to its own theme colours. */
export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral';

export const DEVICE_HEALTH_TONES: Record<DeviceHealth, HealthTone> = {
  ok: 'success',
  attention: 'warning',
  offline: 'danger',
  retired: 'neutral',
};

export function deviceHealthLabel(health: DeviceHealth): string {
  return DEVICE_HEALTH_LABELS[health];
}

export function deviceHealthTone(health: DeviceHealth): HealthTone {
  return DEVICE_HEALTH_TONES[health];
}

/** Platform filter wording (§E: "Tablets / Web terminals"). */
export const DEVICE_PLATFORM_LABELS: Record<DevicePlatform, string> = {
  android: 'Tablets',
  web: 'Web terminals',
};

/** Singular platform wording for a detail row. */
export const DEVICE_PLATFORM_NAMES: Record<DevicePlatform, string> = {
  android: 'Tablet',
  web: 'Web terminal',
};

/** Error-log wording. */
export const ERROR_LEVEL_LABELS: Record<ErrorLevel, string> = {
  warning: 'Warning',
  error: 'Error',
  fatal: 'Fatal',
};

export const ERROR_LEVEL_TONES: Record<ErrorLevel, HealthTone> = {
  warning: 'warning',
  error: 'danger',
  fatal: 'danger',
};

export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = {
  app: 'App',
  server: 'Server',
};

export const ERROR_STATUS_LABELS: Record<ErrorGroupStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
};

/** `"5 unsynced sales"` / `"1 unsynced sale"`; `null` for 0 or unknown. */
export function unsyncedSalesLabel(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return `${count} unsynced ${count === 1 ? 'sale' : 'sales'}`;
}
