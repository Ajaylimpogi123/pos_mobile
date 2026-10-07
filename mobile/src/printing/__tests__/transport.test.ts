/**
 * The transport resolver (docs/api-contract.md → Printing → Transport): the
 * native module on Android, and an "unavailable" transport with a clear
 * message in Expo Go, in older builds and on other platforms.
 */
import {
  ANDROID_ONLY_MESSAGE,
  EXPO_GO_MESSAGE,
  getPrintTransport,
  isPrintTransportError,
  MISSING_MODULE_MESSAGE,
  resolvePrintTransport,
} from '@/printing/transport';
import { toTransportError } from '@/printing/transport/nativeTransport';

const nativeModule = {
  send: jest.fn(async () => 42),
  probe: jest.fn(async () => 7),
};

describe('resolvePrintTransport', () => {
  it("Expo Go: unavailable, with the contract's message, and every call rejects", async () => {
    const transport = resolvePrintTransport({ platform: 'android', expoGo: true, nativeModule: null });
    expect(transport.available).toBe(false);
    expect(transport.unavailableMessage).toBe("Printing needs the POS dev build. Expo Go can't connect to printers.");
    expect(EXPO_GO_MESSAGE).toBe(transport.unavailableMessage);
    const error: unknown = await transport
      .send({ host: '192.168.1.60', port: 9100 }, new Uint8Array([1]), 5000)
      .catch((caught: unknown) => caught);
    expect(isPrintTransportError(error) && error.code).toBe('unavailable');
    expect(isPrintTransportError(error) && error.retryable).toBe(false);
  });

  it('an Android build without the module asks for the new dev build; other platforms are Android-only', () => {
    expect(resolvePrintTransport({ platform: 'android', expoGo: false, nativeModule: null }).unavailableMessage).toBe(
      MISSING_MODULE_MESSAGE,
    );
    expect(resolvePrintTransport({ platform: 'ios', expoGo: false, nativeModule }).unavailableMessage).toBe(ANDROID_ONLY_MESSAGE);
    expect(resolvePrintTransport({ platform: 'web', expoGo: false, nativeModule: null }).available).toBe(false);
  });

  it('the POS dev build on Android sends through the native module', async () => {
    const transport = resolvePrintTransport({ platform: 'android', expoGo: false, nativeModule });
    expect(transport.available).toBe(true);
    const bytes = new Uint8Array([0x1b, 0x40]);
    await transport.send({ host: '192.168.1.60', port: 9100 }, bytes, 5000);
    expect(nativeModule.send).toHaveBeenCalledWith('192.168.1.60', 9100, bytes, 5000);
    expect(await transport.probe({ host: '192.168.1.60', port: 9100 }, 3000)).toBe(7);
  });

  it('under Jest (no native module) the app transport is unavailable, so nothing is queued', () => {
    expect(getPrintTransport().available).toBe(false);
  });
});

describe('native error codes', () => {
  it('marks only connect-phase errors as retryable', () => {
    const codes = {
      ERR_PRINTER_TIMEOUT: ['timeout', true],
      ERR_PRINTER_REFUSED: ['refused', true],
      ERR_PRINTER_UNREACHABLE: ['unreachable', true],
      ERR_PRINTER_HOST: ['host', true],
      ERR_PRINTER_WRITE: ['write', false],
      ERR_SOMETHING_ELSE: ['unknown', false],
    } as const;
    for (const [native, [code, retryable]] of Object.entries(codes)) {
      const error = toTransportError(Object.assign(new Error('boom'), { code: native }));
      expect([error.code, error.retryable]).toEqual([code, retryable]);
    }
  });
});
