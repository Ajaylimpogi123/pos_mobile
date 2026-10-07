import { useState } from 'react';

import { signOut } from '@/services/session';

/** Logout with a confirmation step. The auth gate redirects to login once signed out. */
export function useLogout() {
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  function requestLogout() {
    setConfirmVisible(true);
  }

  function cancelLogout() {
    if (!signingOut) setConfirmVisible(false);
  }

  async function confirmLogout() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setConfirmVisible(false);
    }
  }

  return { confirmVisible, signingOut, requestLogout, cancelLogout, confirmLogout };
}
