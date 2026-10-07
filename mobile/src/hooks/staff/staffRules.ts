/**
 * Client-side checks mirroring the contract's staff rules (Feature: Staff &
 * Customers, "Staff rules"). The server still validates everything; these
 * only catch obvious mistakes before a round trip.
 */

/** Contract limits. */
export const STAFF_LIMITS = { name: 100, email: 255, passwordMin: 10, passwordMax: 255, pinMin: 4, pinMax: 6 } as const;

/** Shown under every new-password input. */
export const PASSWORD_POLICY_HINT = 'At least 10 characters, with upper- and lowercase letters and a number.';

/** `Password::min(10)->mixedCase()->numbers()`, max 255. Returns the problem, or `null` when it passes. */
export function passwordProblem(password: string): string | null {
  if (password === '') return 'Enter a password.';
  if (password.length < STAFF_LIMITS.passwordMin) return `Use at least ${STAFF_LIMITS.passwordMin} characters.`;
  if (password.length > STAFF_LIMITS.passwordMax) return `Use ${STAFF_LIMITS.passwordMax} characters or fewer.`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return 'Use both upper- and lowercase letters.';
  if (!/\d/.test(password)) return 'Include at least one number.';
  return null;
}

export const PIN_FORMAT_MESSAGE = `Enter ${STAFF_LIMITS.pinMin} to ${STAFF_LIMITS.pinMax} digits.`;

/**
 * PIN format only: exactly 4–6 digits. The "not trivial" rule (1111, 1234,
 * 4321, …) is left to the server, whose 422 message is shown under the field.
 */
export function isPinFormatValid(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** Keeps digits only, at most 6 (the PIN keyboard is numeric, but paste can bring anything). */
export function sanitizePinInput(text: string): string {
  return text.replace(/\D/g, '').slice(0, STAFF_LIMITS.pinMax);
}
