/**
 * Service charge and equal split (docs/api-contract.md → Dine-in Tables &
 * Tabs → §E). Integer centavos only; the products run on `BigInt`.
 *
 * - `S = rhu(T × service_charge_bps, 10000)`, where `T` is the order total
 *   after every discount (Core Sale step 7, after SC/PWD); `total = T + S`.
 *   `S` is never discounted and sits outside the VAT figures.
 * - Equal split into `N` shares: share `k` (1-based) = `floor(total / N)`,
 *   plus 1 centavo for `k ≤ total mod N`.
 *
 * Worked example K: `T = 25700`, `bps = 1000` → `S = 2570`, total `28270`;
 * split 3 ways → `9424 · 9423 · 9423`.
 */
import { rhu } from './pricing';

/** The setting's limits: 0–2000 basis points (0–20%). */
export const SERVICE_CHARGE_MAX_BPS = 2000;

/** `split_count`: 2–10 shares. */
export const SPLIT_COUNT_MIN = 2;
export const SPLIT_COUNT_MAX = 10;

function nonNegativeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
  return BigInt(value);
}

/** `S = rhu(T × bps, 10000)`; 0 when `bps` is 0. */
export function computeServiceCharge(totalCents: number, bps: number): number {
  const total = nonNegativeInteger(totalCents, 'totalCents');
  const rate = nonNegativeInteger(bps, 'bps');
  if (rate === BigInt(0)) return 0;
  return Number(rhu(total * rate, BigInt(10_000)));
}

/** The `count` equal shares of `totalCents`, in share order (they add up to the total). */
export function equalSplitShares(totalCents: number, count: number): number[] {
  const total = nonNegativeInteger(totalCents, 'totalCents');
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError(`count must be a positive integer, got ${String(count)}`);
  const n = BigInt(count);
  const base = Number(total / n);
  const extra = Number(total % n);
  return Array.from({ length: count }, (_value, index) => base + (index < extra ? 1 : 0));
}
