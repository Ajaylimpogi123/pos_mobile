/**
 * Dine-in Tables & Tabs (v1.26 §D/§I): one tab on the web terminal.
 *
 * - `useTab` reads `GET /tabs/{ulid}` (polled every 15 s while shown, like
 *   the Tables view, so another terminal's rounds appear).
 * - `useTabConflict`: §I's `409` dialog; closing it reloads the tab and the
 *   Tables view.
 * - `useTabAction`: the idempotent-write rules for the small tab actions
 *   (guests, close, transfer, merge, open): one `Idempotency-Key` per action,
 *   kept on every retry until a 2xx; a network error or timeout keeps the
 *   key and says the attempt is unconfirmed; `422`s go under their fields;
 *   a `409` goes to the conflict dialog (except the idempotency "still being
 *   processed", which is a banner to retry).
 * - `useSendRound`: **Send to kitchen** from the round cart (its pending
 *   ULID is the round's `ulid`), then the round's kitchen tickets.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { invalidateTables, TABLES_POLL_MS } from '@/hooks/useDiningTables';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { stockKey } from '@/hooks/useStockBadges';
import { classifyOrderError, IN_FLIGHT_MESSAGE } from '@/sale/orderErrors';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import { getTab, sendTabRound } from '@/services/tabs';
import type { Tab } from '@/services/types';
import { useRoundCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { ulid as makeUlid } from '@/utils/ulid';
import { buildTabRoundRequest } from '@pos/core/sale/tab';

export const tabKeys = {
  all: ['tabs'] as const,
  detail: (ulid: string) => ['tabs', 'detail', ulid] as const,
};

/** The banner after a tab action got no answer (it may have gone through). */
export const TAB_UNCONFIRMED_MESSAGE = "We couldn't confirm this change. Try again: it won't be done twice.";

export function useTab(ulid: string | null) {
  const query = useQuery({
    queryKey: tabKeys.detail(ulid ?? ''),
    queryFn: () => getTab(ulid as string),
    enabled: ulid !== null,
    refetchInterval: TABLES_POLL_MS,
  });
  return {
    tab: query.data ?? null,
    loading: ulid !== null && query.isPending,
    error: query.isError && !query.data ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** Stores a tab the server just returned, and refreshes the Tables view. */
export function useTabCache() {
  const queryClient = useQueryClient();
  return (tab: Tab | null, ulid?: string) => {
    if (tab) queryClient.setQueryData(tabKeys.detail(tab.ulid), tab);
    else if (ulid) void queryClient.invalidateQueries({ queryKey: tabKeys.detail(ulid) });
    invalidateTables(queryClient);
  };
}

/** §I: a `409` shows in a dialog; closing it reloads the tab (and the Tables view). */
export function useTabConflict(ulid: string | null) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  return {
    message,
    show: (text: string) => setMessage(text),
    dismiss: () => {
      setMessage(null);
      if (ulid) void queryClient.invalidateQueries({ queryKey: tabKeys.detail(ulid) });
      invalidateTables(queryClient);
    },
  };
}

export type TabConflict = ReturnType<typeof useTabConflict>;

type TabActionOptions<B, R> = {
  /** Sends `body` with the action's `Idempotency-Key`. */
  run: (key: string, body: B) => Promise<R>;
  onConflict: (message: string) => void;
};

export function useTabAction<B, R>({ run, onConflict }: TabActionOptions<B, R>) {
  const key = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function send(body: B): Promise<R | null> {
    if (inFlight.current) return null;
    key.current ??= makeUlid();
    inFlight.current = true;
    setBusy(true);
    setBanner(null);
    setFieldErrors({});
    try {
      const result = await run(key.current, body);
      key.current = null;
      return result;
    } catch (error) {
      if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
        setBanner(TAB_UNCONFIRMED_MESSAGE);
      } else if (isApiValidationError(error)) {
        const fields: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.errors)) if (messages[0]) fields[field] = messages[0];
        setFieldErrors(fields);
        if (Object.keys(fields).length === 0) setBanner(error.message);
      } else if (isApiError(error) && error.status === 409 && error.message.trim() !== IN_FLIGHT_MESSAGE) {
        onConflict(error.message);
      } else {
        setBanner(getErrorMessage(error));
      }
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    send,
    busy,
    banner,
    fieldErrors,
    /** A new action (the dialog opens again): forget the messages; the key is kept until a 2xx. */
    clearMessages: () => {
      setBanner(null);
      setFieldErrors({});
    },
  };
}

/**
 * **Send to kitchen**: the round cart as `POST /tabs/{ulid}/rounds`. The
 * round's ULID is the round cart's pending ULID (made on the first attempt,
 * kept until a 200). A network error or timeout locks the round (Send again
 * resends the same body); `422`s go on the lines (`items.{i}.qty`: "Only 2
 * "Sisig" left in stock.") or the round (`items`: the 200-line cap).
 */
export function useSendRound(tab: Tab | null, onConflict: (message: string) => void) {
  const saveTab = useTabCache();
  const printing = useOrderPrinting();
  const queryClient = useQueryClient();
  const userName = useSessionStore((state) => state.user?.name ?? '');
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  async function send() {
    if (!tab || inFlight.current) return;
    const store = useRoundCartStore.getState();
    if (store.lines.length === 0) return;
    const roundUlid = store.beginCheckout();
    const body = buildTabRoundRequest({ ulid: roundUlid, lines: store.lines });
    inFlight.current = true;
    setBusy(true);
    setBanner(null);
    store.clearServerErrors();
    try {
      const response = await sendTabRound(tab.ulid, body);
      store.completeSale();
      saveTab(response.data);
      toast.success(`Round ${response.round_no} sent to kitchen.`);
      void printing.printTabRound(response.data, response.round_no, roundUlid, userName);
      // The advisory stock badges follow each round.
      void queryClient.invalidateQueries({ queryKey: stockKey });
    } catch (error) {
      const failure = classifyOrderError(error);
      if (failure.kind === 'unconfirmed' || failure.kind === 'inFlight') {
        store.setAwaitingConfirmation(true);
        setBanner(failure.kind === 'inFlight' ? failure.message : "We couldn't confirm the round was sent. Send it again: it won't print twice.");
      } else {
        store.setAwaitingConfirmation(false);
        if (failure.kind === 'cart') store.showServerErrors(failure.errors);
        else if (isApiError(error) && error.status === 409) onConflict(failure.message);
        else setBanner(failure.message);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { send, busy, banner, dismissBanner: () => setBanner(null), printing };
}
