/** Contract: a PIN is 4–6 digits, sent as a string (leading zeros survive). */
export const PIN_LENGTH = { min: 4, max: 6 } as const;

/** Long enough to submit (the pad never lets it grow past the maximum). */
export function isPinComplete(pin: string): boolean {
  return pin.length >= PIN_LENGTH.min && pin.length <= PIN_LENGTH.max && /^\d+$/.test(pin);
}
