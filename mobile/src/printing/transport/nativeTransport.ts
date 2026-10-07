/**
 * The transport backed by the local Expo Module `modules/pos-printer`
 * (Kotlin, Android only). Native error codes become `PrintTransportError`s.
 */
import { POS_PRINTER_ERROR_CODES, type PosPrinterNativeModule } from '../../../modules/pos-printer';

import { PrintTransportError, type PrintTransport, type PrintTransportErrorCode } from './types';

const CODES: Record<string, PrintTransportErrorCode> = {
  [POS_PRINTER_ERROR_CODES.timeout]: 'timeout',
  [POS_PRINTER_ERROR_CODES.refused]: 'refused',
  [POS_PRINTER_ERROR_CODES.unreachable]: 'unreachable',
  [POS_PRINTER_ERROR_CODES.host]: 'host',
  [POS_PRINTER_ERROR_CODES.write]: 'write',
};

/** A native rejection as a typed error. Unknown failures are never treated as retryable. */
export function toTransportError(error: unknown): PrintTransportError {
  if (error instanceof PrintTransportError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : 'The printer connection failed.';
  return new PrintTransportError(CODES[code] ?? 'unknown', message);
}

export function createNativeTransport(module: PosPrinterNativeModule): PrintTransport {
  return {
    available: true,
    unavailableMessage: null,
    async send(target, bytes, timeoutMs) {
      try {
        await module.send(target.host, target.port, bytes, timeoutMs);
      } catch (error) {
        throw toTransportError(error);
      }
    },
    async probe(target, timeoutMs) {
      try {
        return await module.probe(target.host, target.port, timeoutMs);
      } catch (error) {
        throw toTransportError(error);
      }
    },
  };
}
