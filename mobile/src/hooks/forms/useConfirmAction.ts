import { useRef, useState } from 'react';

/**
 * State for a confirm-then-act dialog (e.g. Delete): `request` opens it,
 * `confirm` runs `action` with a busy flag, `cancel` closes it unless busy.
 * The dialog closes when the action settles; errors go to `onError`.
 */
export function useConfirmAction(action: () => Promise<void>, onError: (error: unknown) => void) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
      setVisible(false);
    } catch (error) {
      setVisible(false);
      onError(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    visible,
    busy,
    request: () => setVisible(true),
    confirm: () => void confirm(),
    cancel: () => {
      if (!inFlight.current) setVisible(false);
    },
  };
}

export type ConfirmActionState = ReturnType<typeof useConfirmAction>;
