import { create } from 'zustand';

import type { AppVersionInfo } from '@/services/types';

/**
 * Hardening & Pilot (Phase 8) state for the screens: the error queue size,
 * the server's version rules (§D), the clock reading of the last heartbeat
 * (§E), and the printer test results of this session. Pure state + setters:
 * the work lives in `@/errors/*` and `@/sync/deviceHealth`.
 */

/** The server clock read from a heartbeat: `server_time`, when it arrived, and the round trip. */
export type ServerClockReading = {
  serverTime: string;
  /** `Date.now()` when the answer arrived. */
  receivedAt: number;
  latencyMs: number;
};

/** A test print sent from "This tablet". */
export type PrinterTestResult = { ok: boolean; message: string; at: number };

type DiagnosticsState = {
  /** Errors waiting to be sent (SQLite queue plus any held in memory). */
  errorsPending: number;
  /** The last `AppVersionInfo` (from `GET /app-version` or a heartbeat). */
  versionInfo: AppVersionInfo | null;
  /** `latest_version` whose "Update available" banner was dismissed; `undefined` until loaded. */
  dismissedUpdateVersion: string | null | undefined;
  clock: ServerClockReading | null;
  /** When the last heartbeat succeeded (ms). */
  lastHeartbeatAt: number | null;
  /** "Send diagnostics": when it last finished (ms). */
  diagnosticsSentAt: number | null;
  printerTests: Record<number, PrinterTestResult>;

  setErrorsPending: (count: number) => void;
  setVersionInfo: (info: AppVersionInfo) => void;
  setDismissedUpdateVersion: (version: string | null) => void;
  setHeartbeat: (clock: ServerClockReading) => void;
  setClock: (clock: ServerClockReading) => void;
  setDiagnosticsSentAt: (at: number) => void;
  setPrinterTest: (printerId: number, result: PrinterTestResult) => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

const initialState = {
  errorsPending: 0,
  versionInfo: null,
  dismissedUpdateVersion: undefined,
  clock: null,
  lastHeartbeatAt: null,
  diagnosticsSentAt: null,
  printerTests: {},
};

export const useDiagnosticsStore = create<DiagnosticsState>()((set) => ({
  ...initialState,
  setErrorsPending: (errorsPending) => set({ errorsPending }),
  setVersionInfo: (versionInfo) => set({ versionInfo }),
  setDismissedUpdateVersion: (dismissedUpdateVersion) => set({ dismissedUpdateVersion }),
  setHeartbeat: (clock) => set({ clock, lastHeartbeatAt: clock.receivedAt }),
  setClock: (clock) => set({ clock }),
  setDiagnosticsSentAt: (diagnosticsSentAt) => set({ diagnosticsSentAt }),
  setPrinterTest: (printerId, result) => set((state) => ({ printerTests: { ...state.printerTests, [printerId]: result } })),
  reset: () => set(initialState),
}));
