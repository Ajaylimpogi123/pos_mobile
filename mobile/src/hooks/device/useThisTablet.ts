import { useCallback, useEffect, useState } from 'react';

import { prepareDatabase } from '@/db/database';
import { offlineRepository, type LocalOrderRecord } from '@/db/offlineRepository';
import { requestErrorFlush } from '@/errors/errorQueue';
import { useVersionGate } from '@/hooks/device/useVersionGate';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useNow } from '@/hooks/useNow';
import { API_BASE_URL, probeServer } from '@/services/api';
import { getInstallId } from '@/services/secureStorage';
import type { Printer } from '@/services/types';
import { useConnectivityStore } from '@/stores/connectivity';
import { useDeviceStore } from '@/stores/device';
import { useDiagnosticsStore, type ServerClockReading } from '@/stores/diagnostics';
import { useOfflineStore } from '@/stores/offline';
import { usePrintingStore } from '@/stores/printing';
import { useSessionStore } from '@/stores/session';
import { useSyncStore } from '@/stores/sync';
import { requestCatalogueSync } from '@/sync/catalogueSync';
import { deviceMatches } from '@/sync/deviceRegistration';
import { deviceModel, freeStorageMb, osVersion, printerStatusesFrom, requestHeartbeat, requestVersionCheck } from '@/sync/deviceHealth';
import { requestOutboxSync } from '@/sync/outboxSync';
import { requestStockSync } from '@/sync/stockSync';
import { testPrint } from '@/printing/printActions';
import { hasAnyPermission, PERMISSIONS } from '@/utils/permissions';
import { appVersion } from '@/utils/appVersion';
import { chooseReceiptPrinter } from '@pos/core/printing/routing';

/** §E check 3: the clock is in sync within 2 minutes of `server_time`. */
export const MAX_CLOCK_DRIFT_MS = 2 * 60_000;
/** §E check 4: the menu synced within 24 h. */
export const MENU_FRESH_MS = 24 * 60 * 60_000;

export type CheckState = 'ok' | 'warn' | 'fail';

export type ChecklistItem = {
  key: 'server' | 'registered' | 'clock' | 'menu' | 'printer' | 'failed_sales' | 'app_version';
  label: string;
  state: CheckState;
  /** The fix hint (or a short confirmation). */
  hint: string;
};

/** Device clock minus server clock, corrected by half the round trip (ms). */
export function clockDrift(clock: ServerClockReading): number | null {
  const server = Date.parse(clock.serverTime);
  if (Number.isNaN(server)) return null;
  return clock.receivedAt - (server + clock.latencyMs / 2);
}

export type PrinterRow = { printer: Printer; ok: boolean | null; checkedAt: string | null; isReceipt: boolean };

/**
 * State and actions of "This tablet" (Hardening & Pilot §E): the 7-item
 * checklist, the server / tablet / sync / printers / error-report sections,
 * and Check now, Sync now, View failed sales, Test print*, Send now and Send
 * diagnostics. *Test print needs `system.manage` or `settings.manage`.
 */
export function useThisTablet() {
  const now = useNow(30_000);
  const user = useSessionStore((state) => state.user);
  const online = useIsOnline();
  const serverReachable = useConnectivityStore((state) => state.serverReachable);
  const device = useDeviceStore((state) => state.device);
  const registrationError = useDeviceStore((state) => state.error);
  const clock = useDiagnosticsStore((state) => state.clock);
  const errorsPending = useDiagnosticsStore((state) => state.errorsPending);
  const diagnosticsSentAt = useDiagnosticsStore((state) => state.diagnosticsSentAt);
  const printerTests = useDiagnosticsStore((state) => state.printerTests);
  const pending = useOfflineStore((state) => state.pending);
  const failed = useOfflineStore((state) => state.needsAttention);
  const outboxSyncing = useOfflineStore((state) => state.syncing);
  const lastOutboxSyncAt = useOfflineStore((state) => state.lastOutboxSyncAt);
  const lastStockSyncAt = useOfflineStore((state) => state.lastStockSyncAt);
  const localVersion = useOfflineStore((state) => state.localVersion);
  const lastMenuSyncAt = useSyncStore((state) => state.lastServerTime);
  const config = usePrintingStore((state) => state.config);
  const receiptPrinterId = usePrintingStore((state) => state.receiptPrinterId);
  const reachability = usePrintingStore((state) => state.reachability);
  const gate = useVersionGate();

  const [installId, setInstallId] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [sendingErrors, setSendingErrors] = useState(false);
  const [sendingDiagnostics, setSendingDiagnostics] = useState(false);
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [oldestPendingAt, setOldestPendingAt] = useState<string | null>(null);
  const [failedSales, setFailedSales] = useState<LocalOrderRecord[] | null>(null);
  const [showFailed, setShowFailed] = useState(false);
  const [storageMb] = useState(() => freeStorageMb());

  const canTestPrint = hasAnyPermission(user, [PERMISSIONS.systemManage, PERMISSIONS.settingsManage]);
  const registered = deviceMatches(device, user?.branch.id ?? null);

  useEffect(() => {
    void getInstallId().then(setInstallId);
  }, []);

  // The oldest pending sale and the failed sales follow every outbox change.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!(await prepareDatabase())) return;
        const oldest = await offlineRepository.oldestPendingAt();
        const failedList = await offlineRepository.listLocalOrders({ statuses: ['needs_attention'] });
        if (!active) return;
        setOldestPendingAt(oldest);
        setFailedSales(failedList);
      } catch {
        if (active) setFailedSales([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [localVersion, pending, failed]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const started = Date.now();
      const reachable = await probeServer();
      setLatencyMs(reachable ? Date.now() - started : null);
      await Promise.all([requestHeartbeat({ force: true }), requestVersionCheck({ force: true })]);
    } finally {
      setChecking(false);
    }
  }, []);

  function syncNow() {
    void requestOutboxSync({ force: true });
    void requestCatalogueSync();
    void requestStockSync();
  }

  async function sendErrorsNow() {
    setSendingErrors(true);
    try {
      await requestErrorFlush();
    } finally {
      setSendingErrors(false);
    }
  }

  async function sendDiagnostics() {
    setSendingDiagnostics(true);
    try {
      await Promise.all([requestHeartbeat({ force: true }), requestErrorFlush()]);
      useDiagnosticsStore.getState().setDiagnosticsSentAt(Date.now());
    } finally {
      setSendingDiagnostics(false);
    }
  }

  async function runTestPrint(printer: Printer) {
    setTesting((current) => ({ ...current, [printer.id]: true }));
    try {
      const result = await testPrint(printer);
      useDiagnosticsStore.getState().setPrinterTest(printer.id, { ...result, at: Date.now() });
    } finally {
      setTesting((current) => ({ ...current, [printer.id]: false }));
    }
  }

  // --- Printers ------------------------------------------------------------
  const receipt = config ? chooseReceiptPrinter(config.printers, receiptPrinterId) : null;
  const statuses = new Map(printerStatusesFrom(reachability, printerTests).map((status) => [status.id, status]));
  const printers: PrinterRow[] = (config?.printers ?? [])
    .filter((printer) => printer.is_enabled)
    .map((printer) => {
      const status = statuses.get(printer.id);
      return { printer, ok: status ? status.ok : null, checkedAt: status?.checked_at ?? null, isReceipt: receipt?.id === printer.id };
    });
  const receiptRow = printers.find((row) => row.isReceipt) ?? null;

  // --- Checklist -----------------------------------------------------------
  const drift = clock ? clockDrift(clock) : null;
  const menuAge = lastMenuSyncAt ? now - Date.parse(lastMenuSyncAt) : null;

  const checklist: ChecklistItem[] = [
    online && serverReachable
      ? { key: 'server', label: 'Server reachable', state: 'ok', hint: 'The server answers.' }
      : {
          key: 'server',
          label: 'Server reachable',
          state: 'fail',
          hint: online ? 'The server does not answer. Check that the server PC is on, then tap Check now.' : 'No network. Connect this tablet to the shop Wi-Fi.',
        },
    registered
      ? { key: 'registered', label: 'Tablet registered', state: 'ok', hint: `Registered as ${device?.code ?? ''}.` }
      : {
          key: 'registered',
          label: 'Tablet registered',
          state: 'fail',
          hint: registrationError ?? 'Sign in while online once to register this tablet.',
        },
    drift === null
      ? { key: 'clock', label: 'Clock in sync', state: 'warn', hint: 'Not checked yet. Tap Check now.' }
      : Math.abs(drift) <= MAX_CLOCK_DRIFT_MS
        ? { key: 'clock', label: 'Clock in sync', state: 'ok', hint: 'Within 2 minutes of the server.' }
        : { key: 'clock', label: 'Clock in sync', state: 'fail', hint: "Set the tablet's date and time to automatic." },
    menuAge === null || Number.isNaN(menuAge)
      ? { key: 'menu', label: 'Menu synced within 24 h', state: 'fail', hint: 'The menu has never synced. Tap Sync now while online.' }
      : menuAge <= MENU_FRESH_MS
        ? { key: 'menu', label: 'Menu synced within 24 h', state: 'ok', hint: 'The menu is up to date.' }
        : { key: 'menu', label: 'Menu synced within 24 h', state: 'warn', hint: 'The menu is over a day old. Tap Sync now.' },
    !receiptRow
      ? { key: 'printer', label: 'Receipt printer ready', state: 'fail', hint: 'No receipt printer is set up. Add one in Printers.' }
      : receiptRow.ok === true
        ? { key: 'printer', label: 'Receipt printer ready', state: 'ok', hint: `${receiptRow.printer.name} answered.` }
        : receiptRow.ok === false
          ? { key: 'printer', label: 'Receipt printer ready', state: 'fail', hint: `${receiptRow.printer.name} did not answer. Check its power and cable.` }
          : { key: 'printer', label: 'Receipt printer ready', state: 'warn', hint: 'Not tested yet. Run a test print.' },
    failed === 0
      ? { key: 'failed_sales', label: 'No failed sales', state: 'ok', hint: 'Every sale was accepted.' }
      : { key: 'failed_sales', label: 'No failed sales', state: 'fail', hint: `${failed} ${failed === 1 ? 'sale needs' : 'sales need'} attention. Open View failed sales.` },
    gate.info === null
      ? { key: 'app_version', label: 'App up to date', state: 'warn', hint: "Couldn't check the latest version yet." }
      : gate.status === 'up_to_date'
        ? { key: 'app_version', label: 'App up to date', state: 'ok', hint: `Version ${gate.current ?? ''}.` }
        : gate.status === 'update_available'
          ? { key: 'app_version', label: 'App up to date', state: 'warn', hint: `Version ${gate.info.latest_version} is available.` }
          : { key: 'app_version', label: 'App up to date', state: 'fail', hint: `Update to ${gate.info.min_version} or newer.` },
  ];

  return {
    now,
    checklist,
    server: { url: API_BASE_URL, reachable: online && serverReachable, latencyMs, clock, drift },
    tablet: {
      code: registered ? device.code : null,
      // The name the server answered at registration (it keeps an existing device's name, Q-044).
      name: registered ? (device.name ?? null) : null,
      installIdTail: installId ? installId.slice(-6) : null,
      appVersion: appVersion(),
      os: osVersion(),
      model: deviceModel(),
      storageMb,
    },
    sync: { pending, failed, oldestPendingAt, lastMenuSyncAt, lastStockSyncAt, lastOutboxSyncAt, syncing: outboxSyncing, online },
    failedSales,
    showFailed,
    toggleFailed: () => setShowFailed((value) => !value),
    printers,
    canTestPrint,
    testing,
    printerTests,
    errorsPending,
    diagnosticsSentAt,
    checking,
    sendingErrors,
    sendingDiagnostics,
    checkNow: () => void checkNow(),
    syncNow,
    sendErrorsNow: () => void sendErrorsNow(),
    sendDiagnostics: () => void sendDiagnostics(),
    runTestPrint: (printer: Printer) => void runTestPrint(printer),
  };
}

export type ThisTabletState = ReturnType<typeof useThisTablet>;
