/**
 * PosPrinter: the local Expo Module (`modules/pos-printer`, Kotlin, Android
 * only) that sends raw ESC/POS bytes to a network printer over TCP.
 *
 * Loaded with `requireOptionalNativeModule`, never `requireNativeModule`: it is
 * `null` in Expo Go, in a build made before this module existed, on iOS and
 * web, and under Jest. The app reaches it only through
 * `src/printing/transport`, which turns `null` into an "unavailable" transport.
 *
 * Errors carry a `code`:
 * - connect phase (nothing written): `ERR_PRINTER_TIMEOUT`, `ERR_PRINTER_REFUSED`,
 *   `ERR_PRINTER_UNREACHABLE`, `ERR_PRINTER_HOST`
 * - after the connection opened: `ERR_PRINTER_WRITE` (the printer may have printed part of it)
 */
import { requireOptionalNativeModule } from 'expo';

export type PosPrinterNativeModule = {
  /** Connects (with `timeoutMs`), writes, flushes, drains, closes. Resolves with the bytes sent. */
  send(host: string, port: number, data: Uint8Array, timeoutMs: number): Promise<number>;
  /** Connects and disconnects. Resolves with the connect latency in ms. */
  probe(host: string, port: number, timeoutMs: number): Promise<number>;
};

/** Native error codes (see the module notes). */
export const POS_PRINTER_ERROR_CODES = {
  timeout: 'ERR_PRINTER_TIMEOUT',
  refused: 'ERR_PRINTER_REFUSED',
  unreachable: 'ERR_PRINTER_UNREACHABLE',
  host: 'ERR_PRINTER_HOST',
  write: 'ERR_PRINTER_WRITE',
} as const;

/** The native module, or `null` where it isn't built in. */
export const PosPrinter = requireOptionalNativeModule<PosPrinterNativeModule>('PosPrinter');
