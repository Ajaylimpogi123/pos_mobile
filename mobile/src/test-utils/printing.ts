/**
 * Test-only fixtures for Printing (Phase 4), shaped exactly like the
 * contract (`Printer`, `BranchSettings`, `GET /print-config`), plus a fake
 * `PrintTransport`. Never import from app code.
 */
import { PrintTransportError, type PrintTarget, type PrintTransport, type PrintTransportErrorCode } from '@/printing/transport';
import type { BranchSettings, PrintConfig, Printer } from '@/services/types';

export function makePrinter(overrides: Partial<Printer> & { id: number }): Printer {
  return {
    name: `Printer ${overrides.id}`,
    role: 'kitchen',
    host: '192.168.1.60',
    port: 9100,
    paper_width_mm: 80,
    is_enabled: true,
    is_default_kitchen: false,
    category_ids: [],
    created_at: '2026-09-25T02:00:00Z',
    updated_at: '2026-09-25T02:00:00Z',
    ...overrides,
  };
}

/** The contract's dev seed printers (DEV_PRINTER_HOST = 192.168.1.60): Counter, Kitchen (default; Breakfast, Meals), Bar (Drinks). */
export const COUNTER = makePrinter({ id: 1, name: 'Counter', role: 'cashier', port: 9100 });
export const KITCHEN = makePrinter({ id: 2, name: 'Kitchen', role: 'kitchen', port: 9101, is_default_kitchen: true, category_ids: [1, 2] });
export const BAR = makePrinter({ id: 3, name: 'Bar', role: 'bar', port: 9102, category_ids: [3] });

export function makeSettings(overrides: Partial<BranchSettings> = {}): BranchSettings {
  return {
    receipt_header_lines: ['Main Branch', '123 Rizal St., Makati', 'TIN 000-123-456-000'],
    receipt_footer_lines: ['This is not an official receipt.'],
    auto_print_receipt: true,
    receipt_copies: 1,
    print_kitchen_tickets: true,
    updated_at: null,
    ...overrides,
  };
}

/** `GET /print-config` `data` as the contract example, with the dev seed printers. */
export function makePrintConfig(overrides: Partial<PrintConfig> = {}): PrintConfig {
  return {
    branch: { id: 1, name: 'Main Branch', timezone: 'Asia/Manila' },
    settings: makeSettings(),
    printers: [BAR, COUNTER, KITCHEN],
    generated_at: '2026-09-25T02:05:00Z',
    ...overrides,
  };
}

export type SentDocument = { target: PrintTarget; bytes: Uint8Array };

/**
 * A scriptable transport: `fail(port, code, times)` makes the next `times`
 * sends to that port fail; `hold(port)` keeps sends pending until `release`.
 */
export function createFakeTransport() {
  const sent: SentDocument[] = [];
  const attempts: PrintTarget[] = [];
  const failures = new Map<number, { code: PrintTransportErrorCode; times: number }>();
  const held = new Map<number, (() => void)[]>();
  const holding = new Set<number>();
  const probeResults = new Map<number, boolean>();
  const probes: PrintTarget[] = [];

  const transport: PrintTransport = {
    available: true,
    unavailableMessage: null,
    async send(target, bytes) {
      attempts.push(target);
      if (holding.has(target.port)) {
        await new Promise<void>((resolve) => {
          held.set(target.port, [...(held.get(target.port) ?? []), resolve]);
        });
      }
      const failure = failures.get(target.port);
      if (failure && failure.times > 0) {
        failure.times -= 1;
        throw new PrintTransportError(failure.code, `fake ${failure.code}`);
      }
      sent.push({ target, bytes });
    },
    async probe(target) {
      probes.push(target);
      if (probeResults.get(target.port) === false) throw new PrintTransportError('timeout', 'fake timeout');
      return 12;
    },
  };

  return {
    transport,
    sent,
    attempts,
    probes,
    fail(port: number, code: PrintTransportErrorCode, times = Number.POSITIVE_INFINITY) {
      failures.set(port, { code, times });
    },
    heal(port: number) {
      failures.delete(port);
    },
    hold(port: number) {
      holding.add(port);
    },
    release(port: number) {
      holding.delete(port);
      for (const resolve of held.get(port) ?? []) resolve();
      held.delete(port);
    },
    setReachable(port: number, reachable: boolean) {
      probeResults.set(port, reachable);
    },
    sentTo(port: number) {
      return sent.filter((document) => document.target.port === port);
    },
  };
}

export type FakeTransport = ReturnType<typeof createFakeTransport>;
