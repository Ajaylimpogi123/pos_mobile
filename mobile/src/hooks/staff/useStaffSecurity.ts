import { useRef, useState } from 'react';

import { useConfirmAction } from '@/hooks/forms/useConfirmAction';
import { isPinFormatValid, passwordProblem, PIN_FORMAT_MESSAGE, sanitizePinInput } from '@/hooks/staff/staffRules';
import type { useStaffMutations } from '@/hooks/staff/useStaff';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import type { StaffUser } from '@/services/types';

export type PinDialogMode = 'set' | 'change';

type UseStaffSecurityOptions = {
  staff: StaffUser;
  isSelf: boolean;
  mutations: ReturnType<typeof useStaffMutations>;
  /** PUT …/pin returned a fresh record (`has_pin` changed). */
  onUserChanged: (user: StaffUser) => void;
  /** A failure outside a dialog (e.g. removing the PIN): shown in the form banner. */
  onError: (message: string) => void;
};

/** A 422 message for `field`, else `null`. */
function fieldMessage(error: unknown, field: string): string | null {
  return isApiValidationError(error) ? (error.firstError(field) ?? error.message) : null;
}

export function passwordResetNotice(staff: StaffUser, isSelf: boolean): string {
  return isSelf
    ? 'Your password was changed. Your other devices were signed out; this one stays signed in.'
    : `Password reset. ${staff.name} was signed out on every device and must log in with the new password.`;
}

/**
 * The separate security actions on the staff edit screen:
 * - Reset password: POST /api/v1/admin/users/{id}/password → 204.
 * - Set / change PIN: PUT /api/v1/admin/users/{id}/pin with a 4–6 digit string.
 *   The format is checked locally; "too simple" PINs come back as a 422
 *   whose message shows under the PIN input.
 * - Remove PIN: PUT …/pin with `pin: null` (after a confirm).
 * Each success shows a notice banner on the screen.
 */
export function useStaffSecurity({ staff, isSelf, mutations, onUserChanged, onError }: UseStaffSecurityOptions) {
  const [notice, setNotice] = useState<string | null>(null);

  // --- Reset password ------------------------------------------------------
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBanner, setPasswordBanner] = useState<string | null>(null);
  const passwordInFlight = useRef(false);

  function openPassword() {
    setNotice(null);
    setPasswordValue('');
    setPasswordShown(false);
    setPasswordError(null);
    setPasswordBanner(null);
    setPasswordVisible(true);
  }

  async function submitPassword() {
    if (passwordInFlight.current) return;
    setPasswordBanner(null);
    const problem = passwordProblem(password);
    if (problem) {
      setPasswordError(problem);
      return;
    }
    passwordInFlight.current = true;
    try {
      await mutations.password.mutateAsync({ id: staff.id, password });
      setPasswordVisible(false);
      setPasswordValue('');
      setNotice(passwordResetNotice(staff, isSelf));
    } catch (error) {
      const message = fieldMessage(error, 'password');
      if (message) setPasswordError(message);
      else setPasswordBanner(getErrorMessage(error));
    } finally {
      passwordInFlight.current = false;
    }
  }

  // --- Set / change PIN -----------------------------------------------------
  const [pinMode, setPinMode] = useState<PinDialogMode | null>(null);
  const [pin, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBanner, setPinBanner] = useState<string | null>(null);
  const pinInFlight = useRef(false);

  function openPin() {
    setNotice(null);
    setPinValue('');
    setPinError(null);
    setPinBanner(null);
    setPinMode(staff.has_pin ? 'change' : 'set');
  }

  async function submitPin() {
    if (pinInFlight.current) return;
    setPinBanner(null);
    if (!isPinFormatValid(pin)) {
      setPinError(PIN_FORMAT_MESSAGE);
      return;
    }
    pinInFlight.current = true;
    const mode = pinMode;
    try {
      const user = await mutations.pin.mutateAsync({ id: staff.id, pin });
      onUserChanged(user);
      setPinMode(null);
      setPinValue('');
      setNotice(mode === 'change' ? 'PIN changed.' : 'PIN set.');
    } catch (error) {
      const message = fieldMessage(error, 'pin');
      if (message) setPinError(message);
      else setPinBanner(getErrorMessage(error));
    } finally {
      pinInFlight.current = false;
    }
  }

  // --- Remove PIN -----------------------------------------------------------
  const removePin = useConfirmAction(
    async () => {
      const user = await mutations.pin.mutateAsync({ id: staff.id, pin: null });
      onUserChanged(user);
      setNotice('PIN removed.');
    },
    (error) => onError(getErrorMessage(error)),
  );

  return {
    notice,
    dismissNotice: () => setNotice(null),
    passwordDialog: {
      visible: passwordVisible,
      password,
      setPassword: (value: string) => {
        setPasswordValue(value);
        setPasswordError(null);
      },
      shown: passwordShown,
      toggleShown: () => setPasswordShown((value) => !value),
      error: passwordError,
      banner: passwordBanner,
      busy: mutations.password.isPending,
      open: openPassword,
      cancel: () => {
        if (!passwordInFlight.current) setPasswordVisible(false);
      },
      submit: () => void submitPassword(),
    },
    pinDialog: {
      visible: pinMode !== null,
      mode: pinMode ?? 'set',
      pin,
      setPin: (value: string) => {
        setPinValue(sanitizePinInput(value));
        setPinError(null);
      },
      error: pinError,
      banner: pinBanner,
      busy: mutations.pin.isPending && pinMode !== null,
      open: openPin,
      cancel: () => {
        if (!pinInFlight.current) setPinMode(null);
      },
      submit: () => void submitPin(),
    },
    removePinDialog: {
      ...removePin,
      request: () => {
        setNotice(null);
        removePin.request();
      },
    },
  };
}

export type StaffSecurityState = ReturnType<typeof useStaffSecurity>;
