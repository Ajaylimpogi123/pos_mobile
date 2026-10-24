/**
 * Hardening & Pilot (Phase 8) §C/§D/§E: the heartbeat and the version check.
 *
 * - **Heartbeat** (`POST /devices/heartbeat`): every 5 min while online and
 *   signed in, and on foreground (at most 1/min); "Send diagnostics" forces
 *   one. Silent: it never blocks the UI and its failures are ignored. A
 *   `409 "Register this tablet first."` registers the tablet (next beat succeeds).
 *   The answer's `server_time` feeds the clock check, and its `app` the version check.
 * - **Version check** (`GET /app-version`, no auth): at launch, on foreground
 *   (at most every 15 min), and from every heartbeat answer. Versions compare
 *   as semver (`@pos/core/errors/version`). Nothing is blocked server-side.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { prepareDatabase } from '@/db/database';
import { offlineRepository } from '@/db/offlineRepository';
import { isApiError } from '@/services/api';
import { getAppVersionInfo, sendHeartbeat } from '@/services/devices';
import { getDismissedUpdateVersion, saveDismissedUpdateVersion } from '@/services/secureStorage';
import type { AppVersionInfo, HeartbeatPrinter, HeartbeatRequest } from '@/services/types';
import { useDiagnosticsStore, type PrinterTestResult } from '@/stores/diagnostics';
import { useOfflineStore } from '@/stores/offline';
import { usePrintingStore, type Reachability } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { isDeviceOnline } from '@/sync/catalogueSync';
import { registerThisDevice } from '@/sync/deviceRegistration';
import { appVersion } from '@/utils/appVersion';

/** §E: every 5 minutes while online and signed in. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
/** §E: on foreground, at most once a minute. */
export const HEARTBEAT_MIN_GAP_MS = 60_000;
/** §D: the foreground version check, at most every 15 minutes. */
export const VERSION_CHECK_MIN_GAP_MS = 15 * 60_000;
/** Contract: `printers` max 20. */
const MAX_PRINTERS = 20;

/** Free storage in MB (expo-file-system's `Paths.availableDiskSpace`), or `null`. */
export function freeStorageMb(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const bytes = Paths.availableDiskSpace;
    return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes / (1024 * 1024)) : null;
  } catch {
    return null;
  }
}

export function osVersion(): string | null {
  try {
    return (Device.osVersion ?? String(Platform.Version ?? '')).slice(0, 20) || null;
  } catch {
    return null;
  }
}

export function deviceModel(): string | null {
  try {
    return Device.modelName?.slice(0, 60) ?? null;
  } catch {
    return null;
  }
}

/** The printers with a known status: a reachability probe or a test print from "This tablet" (the newest wins). */
export function printerStatusesFrom(
  reachability: Readonly<Record<number, Reachability>>,
  tests: Readonly<Record<number, PrinterTestResult>>,
): HeartbeatPrinter[] {
  const latest = new Map<number, { ok: boolean; at: number }>();
  for (const [id, probe] of Object.entries(reachability)) {
    if (probe.state === 'checking' || probe.checkedAt <= 0) continue;
    latest.set(Number(id), { ok: probe.state === 'ok', at: probe.checkedAt });
  }
  for (const [id, test] of Object.entries(tests)) {
    const current = latest.get(Number(id));
    if (!current || test.at >= current.at) latest.set(Number(id), { ok: test.ok, at: test.at });
  }
  return [...latest.entries()]
    .slice(0, MAX_PRINTERS)
    .map(([id, status]) => ({ id, ok: status.ok, checked_at: new Date(status.at).toISOString() }));
}

/** `printerStatusesFrom` with the current stores. */
export function printerStatuses(): HeartbeatPrinter[] {
  return printerStatusesFrom(usePrintingStore.getState().reachability, useDiagnosticsStore.getState().printerTests);
}

/** The heartbeat body (§C). Every field this tablet knows; never throws. */
export async function buildHeartbeat(): Promise<HeartbeatRequest> {
  let outboxPending: number | null = null;
  let outboxFailed: number | null = null;
  let oldestPendingAt: string | null = null;
  try {
    if (await prepareDatabase()) {
      const counts = await offlineRepository.countOutbox();
      outboxPending = counts.pending;
      outboxFailed = counts.needsAttention;
      oldestPendingAt = await offlineRepository.oldestPendingAt();
    }
  } catch {
    // Unknown counts are sent as null.
  }
  return {
    app_version: appVersion() ?? '0.0.0',
    os_version: osVersion(),
    device_model: deviceModel(),
    outbox_pending: outboxPending,
    outbox_failed: outboxFailed,
    oldest_pending_at: oldestPendingAt,
    errors_pending: useDiagnosticsStore.getState().errorsPending,
    last_catalogue_sync_at: useSyncStore.getState().lastServerTime,
    last_stock_sync_at: useOfflineStore.getState().lastStockSyncAt,
    storage_free_mb: freeStorageMb(),
    printers: printerStatuses(),
  };
}

/** Applies version rules from `GET /app-version` or a heartbeat. */
export function applyVersionInfo(info: AppVersionInfo | null | undefined): void {
  if (info && typeof info.min_version === 'string' && typeof info.latest_version === 'string') {
    useDiagnosticsStore.getState().setVersionInfo(info);
  }
}

let lastHeartbeatAttempt = 0;
let heartbeatInFlight: Promise<boolean> | null = null;

/**
 * Sends a heartbeat when signed in and online, at most once a minute unless
 * `force`. Resolves `true` when the server answered 200. Never rejects.
 */
export function requestHeartbeat(options: { force?: boolean; now?: number } = {}): Promise<boolean> {
  if (heartbeatInFlight) return heartbeatInFlight;
  const now = options.now ?? Date.now();
  if (!options.force && now - lastHeartbeatAttempt < HEARTBEAT_MIN_GAP_MS) return Promise.resolve(false);
  lastHeartbeatAttempt = now;
  heartbeatInFlight = (async () => {
    try {
      if (useSessionStore.getState().status !== 'signedIn' || useSessionStore.getState().isOffline) return false;
      if (!(await isDeviceOnline())) return false;
      const body = await buildHeartbeat();
      const started = Date.now();
      const response = await sendHeartbeat(body);
      const receivedAt = Date.now();
      useDiagnosticsStore.getState().setHeartbeat({ serverTime: response.server_time, receivedAt, latencyMs: receivedAt - started });
      applyVersionInfo(response.app);
      return true;
    } catch (error) {
      // Silent. "Register this tablet first." → register now; the next beat goes through.
      if (isApiError(error) && error.status === 409) void registerThisDevice();
      return false;
    }
  })().finally(() => {
    heartbeatInFlight = null;
  });
  return heartbeatInFlight;
}

let lastVersionCheck = 0;

/** `GET /app-version`, at most every 15 min unless `force`. Never rejects. */
export async function requestVersionCheck(options: { force?: boolean; now?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  if (!options.force && now - lastVersionCheck < VERSION_CHECK_MIN_GAP_MS) return;
  lastVersionCheck = now;
  try {
    applyVersionInfo(await getAppVersionInfo());
  } catch {
    // Keep the last known rules; checked again on the next trigger.
  }
}

/** Loads which "Update available" version was dismissed (launch). Never rejects. */
export async function loadDismissedUpdate(): Promise<void> {
  useDiagnosticsStore.getState().setDismissedUpdateVersion(await getDismissedUpdateVersion());
}

/** Dismisses the "Update available" banner for this `latest_version`. */
export function dismissUpdate(version: string): void {
  useDiagnosticsStore.getState().setDismissedUpdateVersion(version);
  void saveDismissedUpdateVersion(version);
}

/** Test helper: forget the throttles. */
export function resetDeviceHealthForTests(): void {
  lastHeartbeatAttempt = 0;
  lastVersionCheck = 0;
  heartbeatInFlight = null;
}
