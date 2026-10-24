import { create } from 'zustand';

import { isUlid, ulid } from '@/utils/ulid';

/**
 * What this browser profile remembers as a POS terminal (Web POS §C, §F),
 * in `localStorage`:
 * - `pos.install_id`: the terminal's ULID, made once (each browser profile is one terminal).
 * - `pos.receipt_printer_id`: this terminal's receipt printer choice.
 * The open shift is read from the server (`GET /shifts/current`, Q-035).
 */
const INSTALL_ID_KEY = 'pos.install_id';
const RECEIPT_PRINTER_KEY = 'pos.receipt_printer_id';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the value lasts for this page only.
  }
}

/** The terminal's `install_id`, made (and stored) the first time. */
export function getInstallId(): string {
  const stored = read(INSTALL_ID_KEY);
  if (isUlid(stored)) return stored;
  const created = ulid();
  write(INSTALL_ID_KEY, created);
  return created;
}

function readReceiptPrinterId(): number | null {
  const value = Number(read(RECEIPT_PRINTER_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

type TerminalState = {
  receiptPrinterId: number | null;
  setReceiptPrinterId: (id: number | null) => void;
  /** Shown on the open-shift gate (e.g. the server closed the shift during a sale). Not stored. */
  gateNotice: string | null;
  setGateNotice: (notice: string | null) => void;
};

export const useTerminalStore = create<TerminalState>()((set) => ({
  receiptPrinterId: readReceiptPrinterId(),
  setReceiptPrinterId: (id) => {
    write(RECEIPT_PRINTER_KEY, id === null ? null : String(id));
    set({ receiptPrinterId: id });
  },
  gateNotice: null,
  setGateNotice: (gateNotice) => set({ gateNotice }),
}));
