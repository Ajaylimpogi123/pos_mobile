import type { ShiftReport } from '../contract/types';

/** Cash refunds of a report (Σ `refunds_by_method` cash), for the cash drawer lines. */
export function cashRefundsOf(report: Pick<ShiftReport, 'refunds_by_method'>): number {
  return report.refunds_by_method?.find((method) => method.method === 'cash')?.amount_cents ?? 0;
}
