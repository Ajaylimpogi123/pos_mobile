import { useEffect, useRef, useState } from 'react';

import type { LocalShift } from '@/db/shiftRepository';
import { useCurrentShift } from '@/hooks/shifts/useCurrentShift';
import type { ShiftReport } from '@/services/types';
import { useCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { useShiftStore } from '@/stores/shift';
import {
  closeShiftOnTablet,
  openShiftOnTablet,
  printXRead,
  readLocalShiftReport,
  recordCashMovement,
  type PrintOutcome,
} from '@/shifts/shiftActions';
import { checkCashAmount, checkCloseNote, checkCountedCash, checkOpeningFloat, checkReason } from '@/shifts/shiftForms';
import { varianceOf } from '@/shifts/shiftReport';
import { formatPeso, parsePesoInput } from '@pos/core/money';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { showToast } from '@/stores/toast';

export type ShiftDialog = null | 'menu' | 'cash_in' | 'cash_out' | 'x_read' | 'close';

/** Closing is blocked while a sale waits for confirmation (its retry must keep the same shift). */
export const CLOSE_BLOCKED_MESSAGE = "Finish the unconfirmed sale in checkout before closing the shift.";

type CashForm = { amount: string; reason: string; amountError: string | null; reasonError: string | null; error: string | null };
type CloseForm = {
  step: 'count' | 'confirm';
  counted: string;
  note: string;
  countedError: string | null;
  noteError: string | null;
  error: string | null;
};
type OpenForm = { amount: string; error: string | null; bannerError: string | null };

const EMPTY_CASH: CashForm = { amount: '', reason: '', amountError: null, reasonError: null, error: null };
const EMPTY_CLOSE: CloseForm = { step: 'count', counted: '', note: '', countedError: null, noteError: null, error: null };
const EMPTY_OPEN: OpenForm = { amount: '', error: null, bannerError: null };

/**
 * The Sell screen's shift controls (docs/api-contract.md → Shifts &
 * Reporting → Device rules): the **Open a shift** gate, and the header menu
 * (**Cash in**, **Cash out**, **X-read**, **Close shift**). Every typed value
 * lives here, above the layout switch, so rotating keeps it. Everything works
 * offline: the writes go to SQLite and the outbox.
 */
export function useShiftControls() {
  const current = useCurrentShift();
  const user = useSessionStore((state) => state.user);
  const awaitingConfirmation = useCartStore((state) => state.awaitingConfirmation);
  const gateNotice = useShiftStore((state) => state.gateNotice);
  const lastClose = useShiftStore((state) => state.lastClose);

  const canOpen = hasPermission(user, PERMISSIONS.shiftOpen);
  const canClose = hasPermission(user, PERMISSIONS.shiftClose);

  const [dialog, setDialog] = useState<ShiftDialog>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<OpenForm>(EMPTY_OPEN);
  const [cash, setCash] = useState<CashForm>(EMPTY_CASH);
  const [close, setClose] = useState<CloseForm>(EMPTY_CLOSE);
  /** The local report behind the X-read and the close dialog. */
  const [report, setReport] = useState<{ loading: boolean; value: ShiftReport | null; error: string | null }>({
    loading: false,
    value: null,
    error: null,
  });
  const [xPrint, setXPrint] = useState<PrintOutcome | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const shift = current.shift;

  async function loadReport(forShift: LocalShift) {
    setReport({ loading: true, value: null, error: null });
    const outcome = await readLocalShiftReport(forShift, null);
    if (!mounted.current) return;
    setReport(outcome.ok ? { loading: false, value: outcome.value, error: null } : { loading: false, value: null, error: outcome.message });
  }

  function show(next: ShiftDialog) {
    if (busy) return;
    setDialog(next);
    if (next === 'cash_in' || next === 'cash_out') setCash(EMPTY_CASH);
    if (next === 'close') setClose(EMPTY_CLOSE);
    if (next === 'x_read') setXPrint(null);
    if ((next === 'x_read' || next === 'close') && shift) void loadReport(shift);
  }

  function dismiss() {
    if (!busy) setDialog(null);
  }

  async function submitOpen() {
    if (busy || !user) return;
    const checked = checkOpeningFloat(open.amount);
    if (checked.error !== null) {
      setOpen((form) => ({ ...form, error: checked.error, bannerError: null }));
      return;
    }
    setBusy(true);
    const outcome = await openShiftOnTablet({ user, openingFloatCents: checked.value, now: Date.now() });
    if (!mounted.current) return;
    setBusy(false);
    setOpen(outcome.ok ? EMPTY_OPEN : (form) => ({ ...form, bannerError: outcome.message }));
  }

  async function submitCash() {
    if (busy || !user || !shift || (dialog !== 'cash_in' && dialog !== 'cash_out')) return;
    const amount = checkCashAmount(cash.amount);
    const reason = checkReason(cash.reason);
    if (amount.error !== null || reason.error !== null) {
      setCash((form) => ({ ...form, amountError: amount.error, reasonError: reason.error, error: null }));
      return;
    }
    const type = dialog === 'cash_in' ? 'in' : 'out';
    setBusy(true);
    const outcome = await recordCashMovement({
      user,
      shiftUlid: shift.ulid,
      type,
      amountCents: amount.value,
      reason: reason.value,
      now: Date.now(),
    });
    if (!mounted.current) return;
    setBusy(false);
    if (!outcome.ok) {
      setCash((form) => ({ ...form, error: outcome.message }));
      return;
    }
    setDialog(null);
    // MASTER §6: save success is a toast.
    showToast(`${type === 'in' ? 'Cash in' : 'Cash out'} of ${formatPeso(amount.value)} recorded.`);
  }

  async function submitXRead() {
    if (busy || !shift) return;
    setBusy(true);
    const outcome = await printXRead(shift, user, Date.now());
    if (!mounted.current) return;
    setBusy(false);
    setXPrint(outcome.ok ? outcome.value : { jobIds: [], notice: outcome.message });
  }

  /** Step 1 → 2: the counted cash is checked, then the cashier confirms. */
  function reviewClose() {
    if (busy) return;
    if (awaitingConfirmation) {
      setClose((form) => ({ ...form, error: CLOSE_BLOCKED_MESSAGE }));
      return;
    }
    const counted = checkCountedCash(close.counted);
    const note = checkCloseNote(close.note);
    if (counted.error !== null || note.error !== null) {
      setClose((form) => ({ ...form, countedError: counted.error, noteError: note.error, error: null }));
      return;
    }
    setClose((form) => ({ ...form, step: 'confirm', countedError: null, noteError: null, error: null }));
  }

  async function confirmClose() {
    if (busy || !user || !shift) return;
    const counted = checkCountedCash(close.counted);
    const note = checkCloseNote(close.note);
    if (counted.error !== null || note.error !== null) {
      setClose((form) => ({ ...form, step: 'count', countedError: counted.error, noteError: note.error }));
      return;
    }
    setBusy(true);
    const outcome = await closeShiftOnTablet({
      user,
      shiftUlid: shift.ulid,
      countedCashCents: counted.value,
      closeNote: note.value,
      now: Date.now(),
    });
    if (!mounted.current) return;
    setBusy(false);
    if (!outcome.ok) {
      setClose((form) => ({ ...form, step: 'count', error: outcome.message }));
      return;
    }
    setDialog(null);
    setClose(EMPTY_CLOSE);
  }

  // The close dialog's live figures: expected cash and, once typed, the variance.
  const countedCents = close.counted.trim() === '' ? null : parsePesoInput(close.counted);
  const expectedCents = report.value?.expected_cash_cents ?? null;
  const liveVariance = countedCents !== null && expectedCents !== null ? varianceOf(countedCents, expectedCents) : null;

  return {
    current,
    shift,
    canOpen,
    canClose,
    closeBlocked: awaitingConfirmation,
    gateNotice,
    lastClose,
    dialog,
    busy,
    show,
    dismiss,
    open: {
      ...open,
      setAmount: (amount: string) => setOpen({ amount, error: null, bannerError: null }),
      submit: () => void submitOpen(),
    },
    cash: {
      ...cash,
      type: dialog === 'cash_out' ? ('out' as const) : ('in' as const),
      setAmount: (amount: string) => setCash((form) => ({ ...form, amount, amountError: null, error: null })),
      setReason: (reason: string) => setCash((form) => ({ ...form, reason, reasonError: null, error: null })),
      submit: () => void submitCash(),
    },
    report,
    retryReport: () => {
      if (shift) void loadReport(shift);
    },
    xRead: {
      print: xPrint,
      submit: () => void submitXRead(),
    },
    close: {
      ...close,
      countedCents,
      expectedCents,
      liveVariance,
      setCounted: (counted: string) => setClose((form) => ({ ...form, counted, countedError: null, error: null })),
      setNote: (note: string) => setClose((form) => ({ ...form, note, noteError: null, error: null })),
      review: reviewClose,
      back: () => setClose((form) => ({ ...form, step: 'count' })),
      confirm: () => void confirmClose(),
    },
  };
}

export type ShiftControls = ReturnType<typeof useShiftControls>;
