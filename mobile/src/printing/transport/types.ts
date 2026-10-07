/**
 * The seam between the print queue and the wire (PROJECT_MEMORY §9.6): the
 * queue only knows `PrintTransport`, so a Bluetooth or bridge transport can be
 * added later without touching the documents or the queue.
 */

/** Where to send: taken from the **current** print config at send time. */
export type PrintTarget = {
  host: string;
  port: number;
};

/**
 * - `timeout` · `refused` · `unreachable` · `host`: the connection never
 *   opened, so nothing printed: safe to retry.
 * - `write`: the connection opened and bytes may have reached the printer:
 *   never retried automatically.
 * - `unavailable`: this build can't print (Expo Go, no native module, not Android).
 * - `unknown`: anything else (treated like `write`: never retried automatically).
 */
export type PrintTransportErrorCode = 'timeout' | 'refused' | 'unreachable' | 'host' | 'write' | 'unavailable' | 'unknown';

const CONNECT_PHASE: readonly PrintTransportErrorCode[] = ['timeout', 'refused', 'unreachable', 'host'];

export class PrintTransportError extends Error {
  readonly code: PrintTransportErrorCode;
  /** `true` only for connect-phase errors (nothing was written). */
  readonly retryable: boolean;

  constructor(code: PrintTransportErrorCode, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'PrintTransportError';
    this.code = code;
    this.retryable = CONNECT_PHASE.includes(code);
  }
}

export function isPrintTransportError(error: unknown): error is PrintTransportError {
  return error instanceof PrintTransportError;
}

export type PrintTransport = {
  /** `false` in Expo Go, in a build without the module, and off Android: nothing is ever queued. */
  readonly available: boolean;
  /** Why printing is unavailable (shown to staff), or `null`. */
  readonly unavailableMessage: string | null;
  /** Sends the bytes. Rejects with a `PrintTransportError`. */
  send(target: PrintTarget, bytes: Uint8Array, timeoutMs: number): Promise<void>;
  /** Opens and closes a connection; resolves with the latency (ms). Rejects with a `PrintTransportError`. */
  probe(target: PrintTarget, timeoutMs: number): Promise<number>;
};
