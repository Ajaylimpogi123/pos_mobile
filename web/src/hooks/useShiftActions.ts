/**
 * The terminal's shift actions (docs/api-contract.md → Shifts & Reporting →
 * Shift endpoints and Device rules, adapted to the online-only web terminal):
 *
 * - **Cash in / Cash out** (`shift.open`): `POST /shifts/{ulid}/cash-movements`
 *   with a ULID made when the dialog opens and `occurred_at` = now.
 * - **Close shift** (`shift.close`): step 1 the counted cash (with expected cash
 *   and the variance from the server's live report), step 2 confirm →
 *   `POST /shifts/{ulid}/close`. The Z-read then prints, and the POS screen goes
 *   back to **Open a shift**.
 * - **X-read** (`shift.open`): the server's live report, printed through the queue.
 *
 * The writes are idempotent by `ulid` (the path's for a close). A network
 * error or timeout may have gone through, so the form locks and **Retry**
 * resends the very same body. `409 "Register this tablet first."` registers
 * the terminal and retries once; any other `409` (e.g. "This shift belongs to
 * another tablet.") is shown as it is and the shift is read again. `422`s go
 * under their fields.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { isoSeconds, shiftKeys, withRegisteredTerminal } from '@/hooks/useCurrentShift';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { shiftReadDocument } from '@/printing/shiftDocument';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { closeShift, recordCashMovement } from '@/services/shifts';
import type { CashMovementRequest, CashMovementType, Shift, ShiftCloseRequest } from '@/services/types';
import { useCartStore } from '@/stores/cart';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { useTerminalStore } from '@/stores/terminal';
import { checkCashAmount, checkCloseNote, checkCountedCash, checkReason } from '@/utils/shiftForms';
import { ulid as makeUlid } from '@/utils/ulid';
import { centsToInputText, formatPeso, parsePesoInput } from '@pos/core/money';

/** Closing is blocked while a sale waits for confirmation (its retry must keep the same shift). */
export const CLOSE_BLOCKED_MESSAGE = 'Finish the unconfirmed sale in checkout before closing the shift.';
export const CASH_UNCONFIRMED_MESSAGE = "We couldn't confirm the cash movement. Retry.";
export const CLOSE_UNCONFIRMED_MESSAGE = "We couldn't confirm the close. Retry.";

export type ShiftBanner = { message: string; variant: 'error' | 'warning'; retry: boolean };

type CashForm = {
  type: CashMovementType;
  amount: string;
  reason: string;
  amountError: string | null;
  reasonError: string | null;
};

type CloseForm = {
  step: 'count' | 'confirm';
  counted: string;
  note: string;
  countedError: string | null;
  noteError: string | null;
};

const EMPTY_CLOSE: CloseForm = { step: 'count', counted: '', note: '', countedError: null, noteError: null };

function isUnconfirmed(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
}

export function useShiftActions(shift: Shift | null) {
  const queryClient = useQueryClient();
  const user = useSessionStore((state) => state.user);
  const awaitingSale = useCartStore((state) => state.awaitingConfirmation);
  const printing = useOrderPrinting();
  const zPrinting = useOrderPrinting();

  // --- Cash in / out -------------------------------------------------------
  const [cash, setCash] = useState<CashForm | null>(null);
  const [cashBanner, setCashBanner] = useState<ShiftBanner | null>(null);
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const cashBody = useRef<CashMovementRequest | null>(null);
  const cashAwaiting = cashBanner?.retry === true;

  // --- Close ---------------------------------------------------------------
  const [close, setClose] = useState<CloseForm | null>(null);
  const [closeBanner, setCloseBanner] = useState<ShiftBanner | null>(null);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closed, setClosed] = useState<Shift | null>(null);
  const closeBody = useRef<{ shiftUlid: string; body: ShiftCloseRequest } | null>(null);
  const closeAwaiting = closeBanner?.retry === true;

  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function refreshShift() {
    void queryClient.invalidateQueries({ queryKey: shiftKeys.all });
  }

  /** Another `409` (another terminal's shift, …) or a `403`: say so, and read the shift again. */
  function finalFailure(error: unknown): ShiftBanner {
    if (isApiError(error) && error.status === 409) refreshShift();
    return { message: getErrorMessage(error), variant: 'error', retry: false };
  }

  async function sendCash(body: CashMovementRequest, shiftUlid: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    cashBody.current = body;
    setCashSubmitting(true);
    setCashBanner(null);
    try {
      await withRegisteredTerminal(() => recordCashMovement(shiftUlid, body));
      if (!mounted.current) return;
      cashBody.current = null;
      setCash(null);
      setFlash(`${body.type === 'in' ? 'Cash in' : 'Cash out'} of ${formatPeso(body.amount_cents)} recorded.`);
      refreshShift();
    } catch (error) {
      if (!mounted.current) return;
      if (isUnconfirmed(error)) {
        setCashBanner({ message: CASH_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true });
        return;
      }
      cashBody.current = null;
      if (isApiValidationError(error)) {
        const amountError = error.firstError('amount_cents');
        const reasonError = error.firstError('reason');
        setCash((form) => (form ? { ...form, amountError, reasonError } : form));
        if (!amountError && !reasonError) setCashBanner({ message: error.message, variant: 'error', retry: false });
        return;
      }
      setCashBanner(finalFailure(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setCashSubmitting(false);
    }
  }

  function submitCash() {
    if (!cash || !shift || !user) return;
    if (cashAwaiting && cashBody.current) {
      void sendCash(cashBody.current, shift.ulid);
      return;
    }
    const amount = checkCashAmount(cash.amount);
    const reason = checkReason(cash.reason);
    if (amount.error !== null || reason.error !== null) {
      setCash({ ...cash, amountError: amount.error, reasonError: reason.error });
      return;
    }
    void sendCash(
      {
        ulid: makeUlid(),
        type: cash.type,
        amount_cents: amount.value,
        reason: reason.value,
        occurred_at: isoSeconds(Date.now()),
        user_id: user.id,
      },
      shift.ulid,
    );
  }

  async function sendClose(shiftUlid: string, body: ShiftCloseRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    closeBody.current = { shiftUlid, body };
    setCloseSubmitting(true);
    setCloseBanner(null);
    try {
      const result = await withRegisteredTerminal(() => closeShift(shiftUlid, body));
      if (!mounted.current) return;
      closeBody.current = null;
      setClose(null);
      setClosed(result);
      // The POS screen goes back to "Open a shift".
      const device = registeredDevice(useSessionStore.getState().device);
      if (device) queryClient.setQueryData(shiftKeys.current(device.id), null);
      useTerminalStore.getState().setGateNotice(null);
      refreshShift();
      void zPrinting.printShiftRead(shiftReadDocument(result, 'z_read', user?.branch.name ?? null, isoSeconds(Date.now())), false);
    } catch (error) {
      if (!mounted.current) return;
      if (isUnconfirmed(error)) {
        setCloseBanner({ message: CLOSE_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true });
        return;
      }
      closeBody.current = null;
      if (isApiValidationError(error)) {
        const countedError = error.firstError('counted_cash_cents');
        const noteError = error.firstError('close_note');
        setClose((form) => (form ? { ...form, step: 'count', countedError, noteError } : form));
        if (!countedError && !noteError) setCloseBanner({ message: error.message, variant: 'error', retry: false });
        return;
      }
      setClose((form) => (form ? { ...form, step: 'count' } : form));
      setCloseBanner(finalFailure(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setCloseSubmitting(false);
    }
  }

  function checkClose(form: CloseForm): { counted: number; note: string | null } | null {
    const counted = checkCountedCash(form.counted);
    const note = checkCloseNote(form.note);
    if (counted.error !== null || note.error !== null) {
      setClose({ ...form, step: 'count', countedError: counted.error, noteError: note.error });
      return null;
    }
    return { counted: counted.value, note: note.value };
  }

  const countedCents = close && close.counted.trim() !== '' ? parsePesoInput(close.counted) : null;
  const expectedCents = shift?.report.expected_cash_cents ?? null;
  // The contract (Closing a shift): the app shows expected cash and the variance (counted − expected).
  const liveVariance = countedCents !== null && expectedCents !== null ? countedCents - expectedCents : null;

  return {
    canAct: shift !== null && shift.status === 'open',
    flash,
    dismissFlash: () => setFlash(null),

    /** The X-read: the server's live report on this terminal's receipt printer. */
    xRead: printing,
    printXRead: () => {
      if (!shift) return;
      printing.reset();
      void printing.printShiftRead(shiftReadDocument(shift, 'x_read', user?.branch.name ?? null, isoSeconds(Date.now())), false);
    },

    cash: cash
      ? {
          ...cash,
          banner: cashBanner,
          submitting: cashSubmitting,
          awaiting: cashAwaiting,
          locked: cashSubmitting || cashAwaiting,
          setAmount: (amount: string) => setCash((form) => (form ? { ...form, amount, amountError: null } : form)),
          setReason: (reason: string) => setCash((form) => (form ? { ...form, reason, reasonError: null } : form)),
          submit: submitCash,
        }
      : null,
    openCash: (type: CashMovementType) => {
      if (inFlight.current) return;
      setFlash(null);
      const pending = cashAwaiting ? cashBody.current : null;
      if (pending) {
        // An unconfirmed movement must be retried first (same ULID), so it is never recorded twice.
        setCash({ type: pending.type, amount: centsToInputText(pending.amount_cents), reason: pending.reason, amountError: null, reasonError: null });
        return;
      }
      setCashBanner(null);
      cashBody.current = null;
      setCash({ type, amount: '', reason: '', amountError: null, reasonError: null });
    },
    dismissCash: () => {
      if (inFlight.current) return;
      setCash(null);
      // An unconfirmed movement is kept (with its Retry) for the next time the dialog opens.
      if (!cashAwaiting) {
        setCashBanner(null);
        cashBody.current = null;
      }
    },

    close: close
      ? {
          ...close,
          banner: closeBanner,
          submitting: closeSubmitting,
          awaiting: closeAwaiting,
          locked: closeSubmitting || closeAwaiting,
          blocked: awaitingSale,
          countedCents,
          expectedCents,
          liveVariance,
          setCounted: (counted: string) => setClose((form) => (form ? { ...form, counted, countedError: null } : form)),
          setNote: (note: string) => setClose((form) => (form ? { ...form, note, noteError: null } : form)),
          /** Step 1 → 2: the counted cash is checked, then the cashier confirms. */
          review: () => {
            if (!close) return;
            if (awaitingSale) {
              setCloseBanner({ message: CLOSE_BLOCKED_MESSAGE, variant: 'error', retry: false });
              return;
            }
            if (checkClose(close)) {
              setCloseBanner(null);
              setClose({ ...close, step: 'confirm', countedError: null, noteError: null });
            }
          },
          back: () => {
            if (!inFlight.current && !closeAwaiting) setClose((form) => (form ? { ...form, step: 'count' } : form));
          },
          confirm: () => {
            if (!close || !shift || !user) return;
            if (closeAwaiting && closeBody.current) {
              void sendClose(closeBody.current.shiftUlid, closeBody.current.body);
              return;
            }
            if (awaitingSale) {
              setCloseBanner({ message: CLOSE_BLOCKED_MESSAGE, variant: 'error', retry: false });
              return;
            }
            const checked = checkClose(close);
            if (!checked) return;
            void sendClose(shift.ulid, {
              closed_at: isoSeconds(Date.now()),
              closed_by: user.id,
              counted_cash_cents: checked.counted,
              close_note: checked.note,
            });
          },
        }
      : null,
    openClose: () => {
      if (inFlight.current) return;
      setFlash(null);
      setCloseBanner(null);
      closeBody.current = null;
      setClose(EMPTY_CLOSE);
      // The expected cash comes from the server's live report: read it again now.
      refreshShift();
    },
    dismissClose: () => {
      if (inFlight.current) return;
      setClose(null);
      setCloseBanner(null);
      closeBody.current = null;
    },

    /** The shift this terminal just closed (its Z-read), until dismissed. */
    closed,
    zRead: zPrinting,
    reprintZRead: () => {
      if (!closed) return;
      zPrinting.reset();
      void zPrinting.printShiftRead(shiftReadDocument(closed, 'z_read', user?.branch.name ?? null, isoSeconds(Date.now())), true);
    },
    dismissClosed: () => {
      zPrinting.reset();
      setClosed(null);
    },
  };
}

export type ShiftActions = ReturnType<typeof useShiftActions>;
