import * as SecureStore from 'expo-secure-store';

import type { AuthUser } from '@/services/types';
import { isUlid } from '@/utils/ulid';

/**
 * Everything the session persists lives in expo-secure-store (encrypted at
 * rest). Never put the token in AsyncStorage or plain state.
 *
 * Keys may only contain alphanumerics, `.`, `-` and `_`.
 */
const KEYS = {
  token: 'pos.auth.token',
  expiresAt: 'pos.auth.expires_at',
  user: 'pos.auth.user',
  sidebarCollapsed: 'pos.ui.sidebar_collapsed',
  tablesView: 'pos.ui.tables_view',
  receiptPrinterId: 'pos.print.receipt_printer_id',
  installId: 'pos.device.install_id',
  registeredDevice: 'pos.device.registered',
  dismissedUpdateVersion: 'pos.app.dismissed_update_version',
} as const;

/**
 * Keys written by older builds that nothing reads any more. Deleted once,
 * best-effort, at startup so old installs are cleaned up.
 * - Contract revision 2 removed the remembered login device code.
 */
const LEGACY_KEYS = ['pos.device.code'] as const;

export type StoredSession = {
  token: string;
  expiresAt: string | null;
};

// --- Token + expiry --------------------------------------------------------

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.token);
}

export async function getStoredSession(): Promise<StoredSession | null> {
  const [token, expiresAt] = await Promise.all([
    SecureStore.getItemAsync(KEYS.token),
    SecureStore.getItemAsync(KEYS.expiresAt),
  ]);
  if (!token) return null;
  return { token, expiresAt };
}

export async function saveSession(token: string, expiresAt: string, user: AuthUser): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.token, token),
    SecureStore.setItemAsync(KEYS.expiresAt, expiresAt),
    saveUser(user),
  ]);
}

/** Removes the token, its expiry and the cached user. */
export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.token),
    SecureStore.deleteItemAsync(KEYS.expiresAt),
    SecureStore.deleteItemAsync(KEYS.user),
  ]);
}

// --- Cached user (lets the app open offline) -------------------------------

export async function saveUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync(KEYS.user, JSON.stringify(user));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Minimal shape check on the cached user, so a corrupt or very old cache
 * never crashes a screen. Extra keys (e.g. the pre-revision-2 device object)
 * are tolerated and simply never read.
 */
function isCachedAuthUser(value: unknown): value is AuthUser {
  return (
    isObject(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string' &&
    typeof value.email === 'string' &&
    isObject(value.role) &&
    isObject(value.branch) &&
    Array.isArray(value.permissions)
  );
}

export async function getUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync(KEYS.user);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCachedAuthUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --- UI preferences (per device, kept across sign-outs) --------------------

/**
 * Whether the persistent sidebar is collapsed to its icon rail (tablet
 * landscape). `null` when never set or unreadable: the caller uses its
 * default. Never throws.
 */
export async function getSidebarCollapsed(): Promise<boolean | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.sidebarCollapsed);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

/** Best-effort save of the sidebar preference. Never throws. */
export async function saveSidebarCollapsed(collapsed: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.sidebarCollapsed, collapsed ? '1' : '0');
  } catch {
    // A preference that can't be saved just falls back to the default next launch.
  }
}

/** Table Management §C: Sell → Tables shows the floor plan or the grid on this device. */
export type TablesViewPreference = 'floor' | 'grid';

/** The Floor | Grid choice on this device; `null` when never set or unreadable. Never throws. */
export async function getTablesViewPreference(): Promise<TablesViewPreference | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.tablesView);
    return raw === 'floor' || raw === 'grid' ? raw : null;
  } catch {
    return null;
  }
}

/** Best-effort save of the Floor | Grid choice. Never throws. */
export async function saveTablesViewPreference(view: TablesViewPreference): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.tablesView, view);
  } catch {
    // A preference that can't be saved just falls back to the default next launch.
  }
}

/**
 * This tablet's receipt printer (Printing, Phase 4): a printer id chosen on
 * the device ("Receipts from this tablet"). `null` when never set or
 * unreadable: routing falls back to the only enabled receipt printer, then
 * the first by name. Never throws.
 */
export async function getReceiptPrinterId(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.receiptPrinterId);
    if (!raw || !/^[1-9]\d{0,15}$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : null;
  } catch {
    return null;
  }
}

/** Best-effort save (or clear, with `null`) of the receipt printer choice. Never throws. */
export async function saveReceiptPrinterId(id: number | null): Promise<void> {
  try {
    if (id === null) await SecureStore.deleteItemAsync(KEYS.receiptPrinterId);
    else await SecureStore.setItemAsync(KEYS.receiptPrinterId, String(id));
  } catch {
    // The choice falls back to the default next launch.
  }
}

/**
 * Hardening & Pilot §D: the `latest_version` whose "Update available" banner
 * was dismissed (shown once per version). `null` when never set. Never throws.
 */
export async function getDismissedUpdateVersion(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(KEYS.dismissedUpdateVersion)) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort save of the dismissed update version. Never throws. */
export async function saveDismissedUpdateVersion(version: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.dismissedUpdateVersion, version.slice(0, 20));
  } catch {
    // The banner shows again next launch.
  }
}

// --- Device identity (Offline Sales, Phase 5) ------------------------------

/**
 * This install's `install_id` (a ULID made once and kept across sign-outs),
 * or `null` when none was made yet or it can't be read. Never throws.
 */
export async function getInstallId(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.installId);
    return raw && isUlid(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Saves the `install_id`. Throws when it can't be stored (a registration must not send an id it can't keep). */
export async function saveInstallId(installId: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.installId, installId);
}

/**
 * The device as last registered (`POST /devices/register`): its `{id, code}`,
 * plus the API origin and branch it was registered for (a device registered
 * with another server or branch doesn't count). Kept across sign-outs.
 */
export type CachedDevice = {
  id: number;
  code: string;
  apiOrigin: string;
  branchId: number;
  /**
   * The name the **server** answered with (Q-044: registration keeps an existing
   * device's name, so it may differ from the name the tablet sent). Absent in caches from older builds.
   */
  name?: string;
};

function isCachedDevice(value: unknown): value is CachedDevice {
  return (
    isObject(value) &&
    typeof value.id === 'number' &&
    typeof value.code === 'string' &&
    typeof value.apiOrigin === 'string' &&
    typeof value.branchId === 'number'
  );
}

/** The cached device, or `null` (never registered, or unreadable). Never throws. */
export async function getCachedDevice(): Promise<CachedDevice | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEYS.registeredDevice);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedDevice(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Best-effort save of the registered device. Never throws. */
export async function saveCachedDevice(device: CachedDevice): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.registeredDevice, JSON.stringify(device));
  } catch {
    // The next registration saves it again.
  }
}

// --- Legacy cleanup --------------------------------------------------------

/** Best-effort delete of keys older builds wrote. Never throws. */
export async function deleteLegacyKeys(): Promise<void> {
  await Promise.all(LEGACY_KEYS.map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)));
}
