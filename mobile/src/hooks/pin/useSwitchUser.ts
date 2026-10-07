import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { ROUTES } from '@/constants/routes';
import { usePinUsers } from '@/hooks/pin/usePinUsers';
import { useIsOnline } from '@/hooks/useIsOnline';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { signInWithPin, signOut } from '@/services/session';
import type { PinUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';
import { isPinComplete } from '@/utils/pin';

/**
 * The PIN quick-switch (docs/api-contract.md → Core Sale → App → PIN switch):
 * a grid of `pin-users`, then a PIN pad. On success the token and the user
 * are swapped exactly like a login (`signInWithPin`), the cart and the
 * on-device menu stay as they are, and every cached query is reset so
 * nothing of the previous user's data is shown. "Use email instead" logs out.
 *
 * The PIN only ever lives in this state while it is typed; it is cleared
 * after every attempt.
 */
export function useSwitchUser() {
  const currentUser = useSessionStore((state) => state.user);
  const online = useIsOnline();
  const users = usePinUsers();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<PinUser | null>(null);
  const [pin, setPin] = useState('');
  /** Under the PIN pad: wrong PIN, locked PIN, network. */
  const [pinError, setPinError] = useState<string | null>(null);
  /** Above the grid: e.g. "This person can't sign in with a PIN." */
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const inFlight = useRef(false);

  function choose(person: PinUser) {
    setSelected(person);
    setPin('');
    setPinError(null);
    setBanner(null);
  }

  function back() {
    if (submitting) return;
    setSelected(null);
    setPin('');
    setPinError(null);
  }

  async function submit() {
    if (!selected || !isPinComplete(pin) || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setPinError(null);
    try {
      const user = await signInWithPin({ userId: selected.id, pin });
      setPin('');
      // Everything cached belonged to the previous user: reset it (active screens refetch as the new user).
      void queryClient.resetQueries();
      router.navigate(hasPermission(user, PERMISSIONS.saleCreate) ? ROUTES.sell : ROUTES.home);
    } catch (error) {
      setPin('');
      if (isApiValidationError(error) && error.firstError('user_id')) {
        setSelected(null);
        setBanner(error.firstError('user_id'));
      } else if (isApiValidationError(error)) {
        setPinError(error.firstError('pin') ?? error.message);
      } else {
        setPinError(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function logOutForEmail() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return {
    currentUserId: currentUser?.id ?? null,
    online,
    users,
    selected,
    choose,
    back,
    pin,
    setPin: (value: string) => {
      setPin(value);
      setPinError(null);
    },
    pinError,
    banner,
    submitting,
    canSubmit: selected !== null && isPinComplete(pin) && !submitting && online,
    submit: () => void submit(),
    signingOut,
    /** "Use email instead": log out, then the login screen. */
    emailInstead: () => void logOutForEmail(),
  };
}

export type SwitchUserState = ReturnType<typeof useSwitchUser>;
