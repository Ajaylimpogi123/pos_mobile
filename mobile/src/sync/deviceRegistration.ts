/**
 * Device registration (docs/api-contract.md → Offline Sales → Device rules →
 * Registration). Staff never type a device code: the tablet registers itself.
 *
 * - The app keeps an `install_id`: a ULID made once per install, in SecureStore.
 * - `POST /devices/register` runs after login, after a session restore and
 *   after a PIN switch, while online (`useOfflineSalesTriggers`), and when the
 *   outbox worker hears `409 "Register this tablet first."`. It binds the
 *   current token to the device.
 * - The returned `{id, code}` is cached on the device, with the API origin and
 *   the branch it was registered for: a cache from another server or branch
 *   doesn't count.
 * - A device that has **never** registered can't sell offline
 *   (`OFFLINE_SETUP_MESSAGE`).
 * - One registration at a time: a call during one joins it.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';

import { API_BASE_URL, getErrorMessage } from '@/services/api';
import { registerDevice } from '@/services/devices';
import { getCachedDevice, getInstallId, saveCachedDevice, saveInstallId, type CachedDevice } from '@/services/secureStorage';
import type { RegisteredDevice } from '@/services/types';
import { useDeviceStore } from '@/stores/device';
import { useSessionStore } from '@/stores/session';
import { DEVICE_CODE_PATTERN } from '@/sale/localOrder';
import { ulid } from '@/utils/ulid';

/** Contract: shown when an offline sale is attempted on a tablet that never registered. */
export const OFFLINE_SETUP_MESSAGE = 'Connect once to set up offline sales.';

/** Contract limits of the body: `name` max 60, `app_version` max 20. */
export const DEVICE_NAME_MAX = 60;
export const APP_VERSION_MAX = 20;

const FALLBACK_DEVICE_NAME = 'POS tablet';

/** The install's `install_id`, made (and stored) the first time. Throws when it can't be stored. */
export async function ensureInstallId(): Promise<string> {
  const stored = await getInstallId();
  if (stored) return stored;
  const created = ulid();
  await saveInstallId(created);
  return created;
}

/** The device's model name (e.g. "Galaxy Tab A9+"), trimmed to the contract's 60 characters. */
export function deviceDisplayName(): string {
  let name: string | null = null;
  try {
    name = Device.modelName ?? Device.deviceName ?? null;
  } catch {
    name = null;
  }
  const trimmed = (name ?? '').trim();
  return (trimmed === '' ? FALLBACK_DEVICE_NAME : trimmed).slice(0, DEVICE_NAME_MAX);
}

/** The app version from app.json (`expo.version`), or `null`. */
export function appVersion(): string | null {
  const version = Constants.expoConfig?.version?.trim();
  return version ? version.slice(0, APP_VERSION_MAX) : null;
}

/** Whether a cached device belongs to this server and branch (and has a code `order_no` can carry). */
export function deviceMatches(device: CachedDevice | null, branchId: number | null): device is CachedDevice {
  return (
    device !== null &&
    branchId !== null &&
    device.apiOrigin === API_BASE_URL &&
    device.branchId === branchId &&
    DEVICE_CODE_PATTERN.test(device.code)
  );
}

/** Loads the cached device into the store (startup). Never rejects. */
export async function loadCachedDevice(): Promise<CachedDevice | null> {
  const cached = await getCachedDevice();
  useDeviceStore.getState().setLoaded(cached);
  return useDeviceStore.getState().device;
}

/**
 * The device that numbers this user's offline sales: the cached registration
 * for this API origin and the signed-in user's branch, or `null` (never
 * registered here: offline sales can't be numbered).
 */
export async function offlineDevice(): Promise<CachedDevice | null> {
  const branchId = useSessionStore.getState().user?.branch.id ?? null;
  const store = useDeviceStore.getState();
  const device = store.loaded ? store.device : await loadCachedDevice();
  return deviceMatches(device, branchId) ? device : null;
}

let registering: Promise<RegisteredDevice | null> | null = null;

async function register(): Promise<RegisteredDevice | null> {
  const user = useSessionStore.getState().user;
  if (useSessionStore.getState().status !== 'signedIn' || !user) return null;
  const store = useDeviceStore.getState();
  store.startRegistering();
  try {
    const installId = await ensureInstallId();
    const device = await registerDevice({ install_id: installId, name: deviceDisplayName(), app_version: appVersion() });
    const cached: CachedDevice = { id: device.id, code: device.code, apiOrigin: API_BASE_URL, branchId: user.branch.id };
    await saveCachedDevice(cached);
    useDeviceStore.getState().setRegistered(cached);
    return device;
  } catch (error) {
    useDeviceStore.getState().setRegistrationError(getErrorMessage(error));
    return null;
  }
}

/**
 * `POST /devices/register` with this install's id, then caches `{id, code}`.
 * `null` when it failed (offline, 409 another branch, …; the message is in the
 * device store) or nobody is signed in. Never rejects.
 */
export function registerThisDevice(): Promise<RegisteredDevice | null> {
  if (registering) return registering;
  registering = register().finally(() => {
    registering = null;
  });
  return registering;
}
