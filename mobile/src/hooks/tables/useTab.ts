import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ROUTES } from '@/constants/routes';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { useIsOnline } from '@/hooks/useIsOnline';
import { printBill, printTabRound, type TabPrintResult } from '@/printing/printActions';
import { classifyOrderError, IN_FLIGHT_MESSAGE, KEY_REUSED_MESSAGE } from '@/sale/orderErrors';
import { getErrorMessage, isApiError } from '@/services/api';
import { closeTab, getTab, sendRound, updateTab } from '@/services/tables';
import type { Tab } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { dropRoundCart, roundCartFor } from '@/stores/tabCarts';
import { showToast } from '@/stores/toast';
import { ulid as makeUlid } from '@/utils/ulid';
import { buildTabRoundRequest } from '@pos/core/sale/tab';

import { useSellModeStore } from './useTablesView';

/** The tab is re-read this often while its screen is open (other devices add rounds and pay). */
export const TAB_POLL_MS = 15_000;
/** A `409` "still being processed" is retried after this long, up to this many times. */
export const TAB_IN_FLIGHT_RETRY_MS = 1500;
export const TAB_IN_FLIGHT_MAX_RETRIES = 3;

export const ROUND_UNCONFIRMED_MESSAGE = "We couldn't confirm the round reached the kitchen. Retry: it won't be sent twice.";
export const ROUND_PROBLEMS_MESSAGE = 'Fix the highlighted items, then send again.';

export type TabBanner = { message: string; variant: 'error' | 'warning' | 'info' | 'success'; retry?: boolean };

/** A `409` that isn't about the idempotency key: the bill changed elsewhere (closed, occupied, dine-in off, …). */
export function isTabConflict(error: unknown): error is Error {
  if (!isApiError(error) || error.status !== 409) return false;
  const message = error.message.trim();
  return message !== IN_FLIGHT_MESSAGE && message !== KEY_REUSED_MESSAGE;
}

/**
 * One open tab (Dine-in Tables & Tabs §D, online only): `GET /tabs/{ulid}`
 * (re-read every 15 s while on screen), **Send to kitchen** (the round cart
 * as `POST /tabs/{ulid}/rounds`, then the round's kitchen ticket), guests
 * (`PATCH`), **Print bill** and **Close**. A `409` shows in a dialog that
 * reloads the tab; a `422` on a round shows on its lines; a lost answer
 * locks the round and **Retry** resends it with the same ULID.
 */
export function useTab(ulid: string) {
  const client = useQueryClient();
  const online = useIsOnline();
  const user = useSessionStore((state) => state.user);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const query = useQuery({
    queryKey: tableKeys.tab(ulid),
    queryFn: () => getTab(ulid),
    enabled: online && ulid !== '',
    refetchInterval: focused && online ? TAB_POLL_MS : false,
  });
  const tab = query.data ?? null;
  const round = roundCartFor(ulid);

  const [banner, setBanner] = useState<TabBanner | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<null | 'close' | 'guests' | 'bill'>(null);
  const [print, setPrint] = useState<TabPrintResult | null>(null);
  const [guestsDraft, setGuestsDraft] = useState<number | null>(null);
  const [guestsError, setGuestsError] = useState<string | null>(null);
  const [closeAsked, setCloseAsked] = useState(false);

  const inFlight = useRef(false);
  const retries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeKey = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const refreshTables = useCallback(() => {
    void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
  }, [client]);

  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: tableKeys.tab(ulid) });
    refreshTables();
  }, [client, ulid, refreshTables]);

  function store(next: Tab) {
    client.setQueryData(tableKeys.tab(ulid), next);
    refreshTables();
  }

  /** `409`: the message in a dialog, and the tab re-read. */
  function showConflict(error: unknown): boolean {
    if (!isTabConflict(error)) return false;
    setConflict(error.message);
    reload();
    return true;
  }

  async function send() {
    const cart = round.getState();
    if (inFlight.current || cart.lines.length === 0 || !tab) return;
    const key = cart.beginCheckout();
    const body = buildTabRoundRequest({ ulid: key, lines: cart.lines });
    inFlight.current = true;
    setSending(true);
    setBanner(null);
    setPrint(null);
    cart.clearServerErrors();
    let failure: unknown = null;
    try {
      const result = await sendRound(ulid, body);
      retries.current = 0;
      round.getState().completeSale();
      store(result.data);
      // MASTER §6: "Sent to kitchen" is a toast.
      if (mounted.current) showToast(`Round ${result.round_no} sent to the kitchen.`);
      const sentBy = result.data.items.find((item) => item.round_no === result.round_no)?.added_by.name ?? user?.name ?? '';
      const printed = await printTabRound(result.data, result.round_no, key, sentBy);
      if (mounted.current) setPrint(printed);
    } catch (error) {
      failure = error;
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    if (failure === null) return;

    const classified = classifyOrderError(failure);
    if (classified.kind === 'unconfirmed' || classified.kind === 'inFlight') {
      round.getState().setAwaitingConfirmation(true);
      if (classified.kind === 'inFlight' && retries.current < TAB_IN_FLIGHT_MAX_RETRIES) {
        retries.current += 1;
        setBanner({ message: classified.message, variant: 'info' });
        timer.current = setTimeout(() => {
          timer.current = null;
          if (mounted.current) void send();
        }, TAB_IN_FLIGHT_RETRY_MS);
      } else {
        setBanner({ message: ROUND_UNCONFIRMED_MESSAGE, variant: 'warning', retry: true });
      }
      return;
    }
    retries.current = 0;
    round.getState().setAwaitingConfirmation(false);
    if (showConflict(failure)) return;
    if (classified.kind === 'cart') {
      round.getState().showServerErrors(classified.errors);
      setBanner({ message: classified.errors.cart ?? ROUND_PROBLEMS_MESSAGE, variant: 'error' });
      return;
    }
    setBanner({ message: classified.message, variant: 'error' });
  }

  async function saveGuests() {
    if (guestsDraft === null || !tab || busy) return;
    setBusy('guests');
    setGuestsError(null);
    try {
      store(await updateTab(ulid, { guests: guestsDraft }, makeUlid()));
      setGuestsDraft(null);
    } catch (error) {
      if (showConflict(error)) setGuestsDraft(null);
      else setGuestsError(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function bill() {
    if (!tab || busy) return;
    setBusy('bill');
    setBanner(null);
    try {
      const result = await printBill(tab);
      setPrint(result);
      if (!result.notice) showToast('Bill sent to the receipt printer.');
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (!tab || busy) return;
    if (!closeKey.current) closeKey.current = makeUlid();
    setBusy('close');
    try {
      await closeTab(ulid, closeKey.current);
      closeKey.current = null;
      setCloseAsked(false);
      dropRoundCart(ulid);
      refreshTables();
      client.removeQueries({ queryKey: tableKeys.tab(ulid) });
      useSellModeStore.getState().setMode('tables');
      router.replace(ROUTES.sell);
    } catch (error) {
      setCloseAsked(false);
      if (!showConflict(error)) setBanner({ message: getErrorMessage(error), variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return {
    online,
    tab,
    loading: query.isPending && online,
    error: query.error,
    refetch: () => void query.refetch(),
    refreshing: query.isRefetching,
    round,
    banner,
    dismissBanner: () => setBanner(null),
    print,
    conflict,
    /** The conflict dialog's OK: the tab is read again. */
    dismissConflict: () => {
      setConflict(null);
      reload();
    },
    sending,
    send: () => void send(),
    busy,
    printBill: () => void bill(),
    guestsDraft,
    guestsError,
    editGuests: () => {
      if (tab) setGuestsDraft(tab.guests);
      setGuestsError(null);
    },
    setGuestsDraft: (guests: number) => setGuestsDraft(guests),
    cancelGuests: () => setGuestsDraft(null),
    saveGuests: () => void saveGuests(),
    closeAsked,
    requestClose: () => setCloseAsked(true),
    cancelClose: () => setCloseAsked(false),
    confirmClose: () => void close(),
    reload,
    /** A dialog of this screen (cancel, transfer, merge) got a `409`: show it here and read the tab again. */
    reloadWithConflict: (message: string) => {
      setConflict(message);
      reload();
    },
  };
}

export type TabState = ReturnType<typeof useTab>;
