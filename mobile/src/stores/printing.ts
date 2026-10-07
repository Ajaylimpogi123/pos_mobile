import { create } from 'zustand';

import type { PrintJobRow } from '@/db/schema';
import type { PrintConfig, PrinterRole } from '@/services/types';

/**
 * Printing state for the screens (docs/api-contract.md → Printing). Pure
 * state and setters: the queue lives in `@/printing/queue`, the jobs in
 * SQLite (`print_jobs`), and the orchestration in `@/printing/printActions`.
 */

/** A print job as the screens show it. */
export type PrintJobView = {
  id: string;
  orderUlid: string;
  queueNo: number;
  kind: PrintJobRow['kind'];
  printerId: number;
  printerName: string;
  printerRole: PrinterRole;
  copyNo: number;
  copies: number;
  isReprint: boolean;
  status: PrintJobRow['status'];
  attempts: number;
  error: string | null;
  dismissed: boolean;
  updatedAt: string;
};

export function toJobView(row: PrintJobRow): PrintJobView {
  return {
    id: row.id,
    orderUlid: row.order_ulid,
    queueNo: row.queue_no,
    kind: row.kind,
    printerId: row.printer_id,
    printerName: row.printer_name,
    printerRole: row.printer_role,
    copyNo: row.copy_no,
    copies: row.copies,
    isReprint: row.is_reprint,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    dismissed: row.dismissed,
    updatedAt: row.updated_at,
  };
}

/** What printing did for one completed sale (the success screen). */
export type SalePrintSummary = {
  /** The sale's first-print jobs (receipts, then tickets). */
  jobIds: string[];
  /** Lines no enabled printer takes ("not sent to any printer"), e.g. "2 x Rice Cake". */
  unrouted: string[];
  /** No enabled receipt printer for this tablet. */
  noReceiptPrinter: boolean;
  /** Auto-print is off: offer "Print receipt" (until one is sent). */
  manualReceipt: boolean;
  /** Printing can't run in this build (Expo Go, …), or couldn't start: shown instead of rows. */
  notice: string | null;
  /** Still working out the jobs. */
  preparing: boolean;
};

export type PrintConfigStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

/** The last reachability probe of a printer. */
export type Reachability = {
  state: 'checking' | 'ok' | 'down';
  /** When the last probe finished (ms), for the once-a-minute throttle. */
  checkedAt: number;
};

type PrintingState = {
  /** The cached or freshly synced `GET /print-config` of the signed-in user's branch. */
  config: PrintConfig | null;
  configStatus: PrintConfigStatus;
  configError: string | null;
  /** This tablet's receipt printer choice (device preference; may point at a printer that no longer qualifies). */
  receiptPrinterId: number | null;
  jobs: Record<string, PrintJobView>;
  sales: Record<string, SalePrintSummary>;
  reachability: Record<number, Reachability>;

  setConfig: (config: PrintConfig | null) => void;
  setConfigStatus: (status: PrintConfigStatus, error?: string | null) => void;
  setReceiptPrinterId: (id: number | null) => void;
  upsertJobs: (jobs: readonly PrintJobView[]) => void;
  setSale: (orderUlid: string, summary: Partial<SalePrintSummary>) => void;
  setReachability: (printerId: number, reachability: Reachability) => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

const EMPTY_SALE: SalePrintSummary = {
  jobIds: [],
  unrouted: [],
  noReceiptPrinter: false,
  manualReceipt: false,
  notice: null,
  preparing: false,
};

const initialState = {
  config: null,
  configStatus: 'idle' as PrintConfigStatus,
  configError: null,
  receiptPrinterId: null,
  jobs: {},
  sales: {},
  reachability: {},
};

export const usePrintingStore = create<PrintingState>()((set) => ({
  ...initialState,

  setConfig: (config) => set({ config }),
  setConfigStatus: (configStatus, error = null) => set({ configStatus, configError: configStatus === 'error' ? error : null }),
  setReceiptPrinterId: (receiptPrinterId) => set({ receiptPrinterId }),
  upsertJobs: (jobs) =>
    set((state) => {
      if (jobs.length === 0) return state;
      const next = { ...state.jobs };
      for (const job of jobs) next[job.id] = job;
      return { jobs: next };
    }),
  setSale: (orderUlid, summary) =>
    set((state) => ({ sales: { ...state.sales, [orderUlid]: { ...EMPTY_SALE, ...state.sales[orderUlid], ...summary } } })),
  setReachability: (printerId, reachability) =>
    set((state) => ({ reachability: { ...state.reachability, [printerId]: reachability } })),
  reset: () => set(initialState),
}));

/** Failed jobs the cashier hasn't dismissed, newest first (the Sell banner). */
export function selectFailedJobs(jobs: Record<string, PrintJobView>): PrintJobView[] {
  return Object.values(jobs)
    .filter((job) => job.status === 'failed' && !job.dismissed)
    .sort((a, b) => (a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt)));
}
