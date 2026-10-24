/**
 * The terminal's current shift (Web POS §G W1: the open-shift gate; Q-035).
 * A sale needs an open shift on this terminal.
 *
 * `GET /shifts/current` returns the open shift of the token's device, or
 * `null`, with its **live** server `report` (the X-read figures). It is read
 * on load and again after a shift is opened, a cash movement or a close. A
 * `409 "Register this tablet first."` (the token isn't bound to the terminal
 * yet) re-registers the terminal and retries once.
 *
 * Opening: `POST /shifts` with a ULID made when the form first submits and
 * kept until it succeeds (idempotent by `ulid`, no `Idempotency-Key` header).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { registerTerminal } from '@/hooks/useAuth';
import { getErrorMessage, isApiError } from '@/services/api';
import { getCurrentShift, openShift } from '@/services/shifts';
import type { Shift } from '@/services/types';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { useTerminalStore } from '@/stores/terminal';
import { ulid } from '@/utils/ulid';

export const shiftKeys = {
  all: ['shifts'] as const,
  current: (deviceId: number | null) => ['shifts', 'current', deviceId] as const,
};

/** The Shifts page refreshes the live X-read this often while it is shown. */
export const LIVE_REPORT_INTERVAL_MS = 30_000;

/** An ISO 8601 UTC time without milliseconds, like the contract's examples. */
export function isoSeconds(time: number): string {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The contract's `409` when the token isn't bound to a device ("tablet"; "terminal" accepted too). */
function isUnregistered(error: unknown): boolean {
  if (!isApiError(error) || error.status !== 409) return false;
  return /^Register this (tablet|terminal) first\.?$/.test(error.message.trim());
}

/**
 * Runs a shift request; on `409 "Register this tablet first."` registers the
 * terminal (binding the token) and runs it once more.
 */
export async function withRegisteredTerminal<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!isUnregistered(error)) throw error;
    await registerTerminal();
    return request();
  }
}

async function readCurrentShift(): Promise<Shift | null> {
  try {
    return await getCurrentShift();
  } catch (error) {
    // The token isn't bound to this terminal yet: register it, then retry once.
    if (isApiError(error) && error.status === 409) {
      await registerTerminal();
      return getCurrentShift();
    }
    throw error;
  }
}

/** `live`: re-read the report on mount and every 30 s (the Shifts page's X-read). */
export function useCurrentShift(options: { live?: boolean } = {}) {
  const device = registeredDevice(useSessionStore((state) => state.device));
  const live = options.live ?? false;
  const query = useQuery({
    queryKey: shiftKeys.current(device?.id ?? null),
    queryFn: readCurrentShift,
    enabled: device !== null,
    staleTime: live ? 0 : 60_000,
    refetchInterval: live ? LIVE_REPORT_INTERVAL_MS : false,
  });
  return {
    shift: query.data ?? null,
    loading: device !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    /** A background re-read is running (the report is being refreshed). */
    refreshing: query.isFetching && !query.isPending,
    /** When the shown report was read (ms), or 0. */
    updatedAt: query.dataUpdatedAt,
    reload: () => void query.refetch(),
  };
}

/** `POST /shifts`, with the ULID kept across retries of the same opening; then `GET /shifts/current` again. */
export function useOpenShift() {
  const queryClient = useQueryClient();
  const pendingUlid = useRef<string | null>(null);
  return useMutation({
    mutationFn: (openingFloatCents: number) => {
      const session = useSessionStore.getState();
      if (!registeredDevice(session.device) || !session.user) throw new Error('This terminal is not registered yet.');
      pendingUlid.current ??= ulid();
      const body = {
        ulid: pendingUlid.current,
        opened_at: isoSeconds(Date.now()),
        opened_by: session.user.id,
        opening_float_cents: openingFloatCents,
      };
      return withRegisteredTerminal(() => openShift(body));
    },
    onSuccess: async () => {
      pendingUlid.current = null;
      useTerminalStore.getState().setGateNotice(null);
      await queryClient.invalidateQueries({ queryKey: shiftKeys.all });
    },
  });
}

/** The server says the shift is closed (the `422` on `shift_ulid` of a sale): show the gate, and re-read. */
export function forgetClosedShift(queryClient: ReturnType<typeof useQueryClient>, message: string): void {
  const device = registeredDevice(useSessionStore.getState().device);
  useTerminalStore.getState().setGateNotice(`${message} The cart is kept.`);
  if (device) queryClient.setQueryData(shiftKeys.current(device.id), null);
  void queryClient.invalidateQueries({ queryKey: ['shifts', 'current'] });
}
