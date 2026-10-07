/**
 * Which transport this build prints with (docs/api-contract.md → Printing →
 * Transport), resolved once, lazily:
 * - Android with the PosPrinter module (the POS dev build): the native transport.
 * - Expo Go: unavailable, with the contract's message. Nothing is queued, and
 *   everything else keeps working.
 * - Android without the module (a build older than Phase 4): unavailable, asking for the new build.
 * - Any other platform: unavailable ("Android tablet only").
 */
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { PosPrinter, type PosPrinterNativeModule } from '../../../modules/pos-printer';

import { createNativeTransport } from './nativeTransport';
import { PrintTransportError, type PrintTransport } from './types';

export { isPrintTransportError, PrintTransportError } from './types';
export type { PrintTarget, PrintTransport, PrintTransportErrorCode } from './types';

/** Contract: shown in Expo Go. */
export const EXPO_GO_MESSAGE = "Printing needs the POS dev build. Expo Go can't connect to printers.";
/** An Android build made before the printer module existed. */
export const MISSING_MODULE_MESSAGE = "This build can't print yet. Install the latest POS dev build to connect to printers.";
/** iOS and web. */
export const ANDROID_ONLY_MESSAGE = 'Printing works on the Android tablet only.';

/** A transport that can't print: every call rejects with `unavailable`. */
export function createUnavailableTransport(message: string): PrintTransport {
  const fail = async (): Promise<never> => {
    throw new PrintTransportError('unavailable', message);
  };
  return { available: false, unavailableMessage: message, send: fail, probe: fail };
}

export type TransportEnvironment = {
  platform: string;
  expoGo: boolean;
  nativeModule: PosPrinterNativeModule | null;
};

/** Pure resolution (tested directly). */
export function resolvePrintTransport(environment: TransportEnvironment): PrintTransport {
  if (environment.platform !== 'android') return createUnavailableTransport(ANDROID_ONLY_MESSAGE);
  if (environment.expoGo) return createUnavailableTransport(EXPO_GO_MESSAGE);
  if (!environment.nativeModule) return createUnavailableTransport(MISSING_MODULE_MESSAGE);
  return createNativeTransport(environment.nativeModule);
}

function runningInExpoGo(): boolean {
  try {
    return isRunningInExpoGo();
  } catch {
    return false;
  }
}

let resolved: PrintTransport | null = null;

/** This build's transport (resolved on first use). */
export function getPrintTransport(): PrintTransport {
  if (!resolved) {
    resolved = resolvePrintTransport({ platform: Platform.OS, expoGo: runningInExpoGo(), nativeModule: PosPrinter });
  }
  return resolved;
}
