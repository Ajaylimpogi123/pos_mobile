/**
 * What the screens call for this tablet's cash shift (docs/api-contract.md →
 * Shifts & Reporting → Device rules). Everything works **offline**: each
 * write is one SQLite transaction with its outbox row, then the outbox worker
 * is asked to send it at once (it does nothing while offline). None of these
 * functions reject: they return an outcome with a message.
 *
 * - `loadCurrentShift`: the open shift for the signed-in branch (the Sell gate).
 * - `openShiftOnTablet`, `recordCashMovement`, `closeShiftOnTablet`.
 * - `localShiftReport`: the tablet's own `ShiftReport` (its sales and cash movements).
 * - `printXRead`; the Z-read prints as part of closing.
 * - `markShiftClosedByServer`: the `422` on `shift_ulid` of an online sale.
 * - `storeOnlineSale`: every completed online sale is stored locally, as `synced`.
 * - `pruneLocalData`: only the current shift and the last 7 days are kept.
 */
import { prepareDatabase } from '@/db/database';
import { offlineRepository } from '@/db/offlineRepository';
import { refundRepository } from '@/db/refundRepository';
import { shiftRepository, ShiftNotOpenError, type LocalShift } from '@/db/shiftRepository';
import type { ShiftReadDocument, ShiftReadKind } from '@/printing/documents/shiftRead';
import { printShiftRead } from '@/printing/printActions';
import { isoSeconds } from '@/sale/localOrder';
import type { AuthUser, CashMovementType, Order, Shift, ShiftReport } from '@/services/types';
import { useDeviceStore } from '@/stores/device';
import { useOfflineStore } from '@/stores/offline';
import { usePrintingStore } from '@/stores/printing';
import { useShiftStore } from '@/stores/shift';
import { refreshOutboxCounts, requestOutboxSync } from '@/sync/outboxSync';
import { computeShiftReport } from '@/shifts/shiftReport';
import { ulid } from '@/utils/ulid';

/** Only the current shift and the last 7 days are kept on the tablet. */
export const LOCAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const SHIFT_STORAGE_MESSAGE = "This tablet's shift couldn't be read. Restart the app and try again.";
export const SHIFT_SAVE_MESSAGE = "This couldn't be saved on the tablet. Nothing was recorded: try again.";
/** Checkout without an open shift. */
export const NO_SHIFT_MESSAGE = 'Open a shift on the Sell screen before charging.';
/** The shift closed while a dialog was open (e.g. another close, or the server). */
export const SHIFT_NOT_OPEN_MESSAGE = 'This shift is already closed. Open a new shift.';
/** Contract: the `422` on `shift_ulid` of an online sale. */
export const SHIFT_CLOSED_SERVER_MESSAGE = 'This shift is closed. Open a new shift.';

export type ShiftOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

function signedInRef(user: AuthUser) {
  return { id: user.id, name: user.name };
}

/** After a shift write: the screens, the pill counts, and the outbox worker (sends at once when online). */
function afterWrite(): void {
  useOfflineStore.getState().markLocalChanged();
  void refreshOutboxCounts();
  void requestOutboxSync();
}

let prunedThisLaunch = false;

/** Test helper: prune again on the next load. */
export function resetShiftActionsForTests(): void {
  prunedThisLaunch = false;
}

/**
 * Deletes synced sales and closed shifts older than 7 days, keeping the
 * current shift's sales whatever their age. Unsynced data is never deleted.
 * Never rejects.
 */
export async function pruneLocalData(now: number, keepShiftUlid: string | null): Promise<void> {
  try {
    if (!(await prepareDatabase())) return;
    const cutoff = isoSeconds(now - LOCAL_RETENTION_MS);
    await offlineRepository.pruneSyncedSales(cutoff, keepShiftUlid);
    // Voids & Refunds (Phase 7): refunds made here are pruned like synced sales.
    await refundRepository.pruneRefunds(cutoff, keepShiftUlid);
    await shiftRepository.pruneClosedShifts(cutoff);
  } catch {
    // Pruning is housekeeping: the next launch tries again.
  }
}

/** Reads this tablet's open shift for the branch into the store (and prunes once per launch). Never rejects. */
export async function loadCurrentShift(branchId: number): Promise<LocalShift | null> {
  const store = useShiftStore.getState();
  store.startLoading(branchId);
  try {
    if (!(await prepareDatabase())) {
      useShiftStore.getState().setError(branchId, SHIFT_STORAGE_MESSAGE);
      return null;
    }
    const shift = await shiftRepository.currentShift(branchId);
    useShiftStore.getState().setLoaded(branchId, shift);
    if (!prunedThisLaunch) {
      prunedThisLaunch = true;
      void pruneLocalData(Date.now(), shift?.ulid ?? null);
    }
    return shift;
  } catch {
    useShiftStore.getState().setError(branchId, SHIFT_STORAGE_MESSAGE);
    return null;
  }
}

/** Opens a shift on this tablet with the starting cash (`shift.open`). */
export async function openShiftOnTablet(input: {
  user: AuthUser;
  openingFloatCents: number;
  now: number;
}): Promise<ShiftOutcome<LocalShift>> {
  try {
    if (!(await prepareDatabase())) return { ok: false, message: SHIFT_SAVE_MESSAGE };
    const openedAt = isoSeconds(input.now);
    const result = await shiftRepository.openShift({
      ulid: ulid(),
      branchId: input.user.branch.id,
      openedAt,
      openedBy: signedInRef(input.user),
      openingFloatCents: input.openingFloatCents,
    });
    const store = useShiftStore.getState();
    store.setLoaded(input.user.branch.id, result.shift);
    store.setGateNotice(null);
    store.setLastClose(null);
    store.setFlash(null);
    if (result.created) afterWrite();
    return { ok: true, value: result.shift };
  } catch {
    return { ok: false, message: SHIFT_SAVE_MESSAGE };
  }
}

/** Cash in or out of the drawer, with a reason (`shift.open`). */
export async function recordCashMovement(input: {
  user: AuthUser;
  shiftUlid: string;
  type: CashMovementType;
  amountCents: number;
  reason: string;
  now: number;
}): Promise<ShiftOutcome<null>> {
  try {
    if (!(await prepareDatabase())) return { ok: false, message: SHIFT_SAVE_MESSAGE };
    await shiftRepository.addCashMovement({
      ulid: ulid(),
      shiftUlid: input.shiftUlid,
      type: input.type,
      amountCents: input.amountCents,
      reason: input.reason,
      occurredAt: isoSeconds(input.now),
      user: signedInRef(input.user),
    });
    afterWrite();
    return { ok: true, value: null };
  } catch (error) {
    if (error instanceof ShiftNotOpenError) {
      await loadCurrentShift(input.user.branch.id);
      return { ok: false, message: SHIFT_NOT_OPEN_MESSAGE };
    }
    return { ok: false, message: SHIFT_SAVE_MESSAGE };
  }
}

/**
 * The tablet's own report of a shift: its sales stored here (a synced sale
 * counts with its server `Order`) and its cash movements. `countedCashCents`
 * overrides the stored count (the close dialog's live preview).
 */
export async function localShiftReport(shift: LocalShift, countedCashCents?: number | null): Promise<ShiftReport> {
  const records = await offlineRepository.listLocalOrders({ shiftUlid: shift.ulid });
  const movements = await shiftRepository.listCashMovements(shift.ulid);
  const refunds = await refundRepository.listForShift(shift.ulid);
  // Q-015: every sale rung into the shift counts, including one the server rejected (needs attention).
  // Phase 7: a sale whose server `Order` is voided counts as a void; refunds come from `local_refunds`.
  return computeShiftReport({
    openingFloatCents: shift.openingFloatCents,
    countedCashCents: countedCashCents === undefined ? shift.countedCashCents : countedCashCents,
    orders: records.map((record) => record.serverOrder ?? record.order),
    movements: movements.map((movement) => ({ type: movement.type, amountCents: movement.amountCents })),
    refunds: refunds.map((record) => record.refund),
  });
}

/** Reads the local report for a screen. Never rejects. */
export async function readLocalShiftReport(shift: LocalShift, countedCashCents?: number | null): Promise<ShiftOutcome<ShiftReport>> {
  try {
    if (!(await prepareDatabase())) return { ok: false, message: SHIFT_STORAGE_MESSAGE };
    return { ok: true, value: await localShiftReport(shift, countedCashCents) };
  } catch {
    return { ok: false, message: SHIFT_STORAGE_MESSAGE };
  }
}

function branchName(user: AuthUser | null): string | null {
  return usePrintingStore.getState().config?.branch.name ?? user?.branch.name ?? null;
}

/** The printed document of a shift stored on this tablet. */
export function localReadDocument(kind: ShiftReadKind, shift: LocalShift, report: ShiftReport, printedAt: number, user: AuthUser | null): ShiftReadDocument {
  return {
    kind,
    shift: {
      ulid: shift.ulid,
      deviceCode: useDeviceStore.getState().device?.code ?? null,
      openedAt: shift.openedAt,
      openedBy: shift.openedBy,
      openingFloatCents: shift.openingFloatCents,
      closedAt: shift.closedAt,
      closedBy: shift.closedBy,
      countedCashCents: shift.countedCashCents,
      closeNote: shift.closeNote,
    },
    report,
    printedAt: isoSeconds(printedAt),
    branchName: branchName(user),
  };
}

/** The printed document of a server `Shift` (Shifts screen → Print): X-read while open, Z-read once closed. */
export function serverReadDocument(shift: Shift, printedAt: number, user: AuthUser | null): ShiftReadDocument {
  return {
    kind: shift.status === 'closed' ? 'z_read' : 'x_read',
    shift: {
      ulid: shift.ulid,
      deviceCode: shift.device.code,
      openedAt: shift.opened_at,
      openedBy: shift.opened_by,
      openingFloatCents: shift.opening_float_cents,
      closedAt: shift.closed_at,
      closedBy: shift.closed_by,
      countedCashCents: shift.counted_cash_cents,
      closeNote: shift.close_note,
    },
    report: shift.report,
    printedAt: isoSeconds(printedAt),
    branchName: branchName(user),
  };
}

export type PrintOutcome = { jobIds: string[]; notice: string | null };

/** X-read (`shift.open`): the open shift's local report, on the receipt printer. Never rejects. */
export async function printXRead(shift: LocalShift, user: AuthUser | null, now: number): Promise<ShiftOutcome<PrintOutcome>> {
  const report = await readLocalShiftReport(shift);
  if (!report.ok) return report;
  const result = await printShiftRead(localReadDocument('x_read', shift, report.value, now, user));
  return { ok: true, value: result };
}

/** Shifts screen → Print: the server's report (a closed shift's Z-read prints as a reprint). Never rejects. */
export async function printServerShift(shift: Shift, user: AuthUser | null, now: number): Promise<PrintOutcome> {
  return printShiftRead(serverReadDocument(shift, now, user), { reprint: shift.status === 'closed' });
}

/**
 * Closes the shift with the counted cash (`shift.close`), then prints the
 * Z-read and sends the Sell screen back to "Open a shift". The close is
 * saved first: a printer problem never undoes it.
 */
export async function closeShiftOnTablet(input: {
  user: AuthUser;
  shiftUlid: string;
  countedCashCents: number;
  closeNote: string | null;
  now: number;
}): Promise<ShiftOutcome<{ shift: LocalShift; report: ShiftReport; print: PrintOutcome }>> {
  let closed: LocalShift;
  try {
    if (!(await prepareDatabase())) return { ok: false, message: SHIFT_SAVE_MESSAGE };
    closed = await shiftRepository.closeShift({
      shiftUlid: input.shiftUlid,
      eventUlid: ulid(),
      closedAt: isoSeconds(input.now),
      closedBy: signedInRef(input.user),
      countedCashCents: input.countedCashCents,
      closeNote: input.closeNote,
    });
  } catch (error) {
    if (error instanceof ShiftNotOpenError) {
      await loadCurrentShift(input.user.branch.id);
      return { ok: false, message: SHIFT_NOT_OPEN_MESSAGE };
    }
    return { ok: false, message: SHIFT_SAVE_MESSAGE };
  }

  afterWrite();
  const store = useShiftStore.getState();
  store.setLoaded(input.user.branch.id, null);
  store.setFlash(null);

  let report: ShiftReport;
  let print: PrintOutcome;
  try {
    report = await localShiftReport(closed);
    print = await printShiftRead(localReadDocument('z_read', closed, report, input.now, input.user));
  } catch {
    report = computeShiftReport({ openingFloatCents: closed.openingFloatCents, countedCashCents: closed.countedCashCents, orders: [], movements: [] });
    print = { jobIds: [], notice: "The Z-read couldn't be prepared. The shift is closed." };
  }
  useShiftStore.getState().setLastClose({ shiftUlid: closed.ulid, jobIds: print.jobIds, notice: print.notice });
  void pruneLocalData(input.now, null);
  return { ok: true, value: { shift: closed, report, print } };
}

/**
 * An online sale answered `422` on `shift_ulid` ("This shift is closed. Open a
 * new shift."): the shift is closed here too (nothing is sent: the server
 * already has it), and the Sell screen shows "Open a shift" with the message.
 * Never rejects.
 */
export async function markShiftClosedByServer(shiftUlid: string, message: string, branchId: number, now: number): Promise<void> {
  try {
    if (await prepareDatabase()) await shiftRepository.markClosedByServer(shiftUlid, isoSeconds(now));
  } catch {
    // The store still moves to the gate below; the next load reads the row again.
  }
  const store = useShiftStore.getState();
  if (store.current?.ulid === shiftUlid) store.setLoaded(branchId, null);
  store.setGateNotice(message);
}

/**
 * Stores a completed **online** sale on the tablet as `synced` (a `201`, or
 * the Q-004 lookup), so the tablet can compute its shift report. Never
 * rejects: this never affects the sale.
 */
export async function storeOnlineSale(order: Order, shiftUlid: string | null, user: AuthUser, now: number): Promise<void> {
  try {
    if (!(await prepareDatabase())) return;
    const written = await offlineRepository.saveSyncedSale(order, { branchId: user.branch.id, shiftUlid, now: isoSeconds(now) });
    if (written) useOfflineStore.getState().markLocalChanged();
  } catch {
    // The report on this tablet misses this sale; the server's report has it.
  }
}
