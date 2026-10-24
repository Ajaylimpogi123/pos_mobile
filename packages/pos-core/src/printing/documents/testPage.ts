/**
 * The test page (docs/api-contract.md → Printing → Test page): the printer's
 * name, role, `host:port` and paper width, a column ruler (to check the
 * column count), the sample text `Niño Peña é ₱` (to check the code page:
 * ñ and é print as themselves, ₱ as P), and the time.
 */
import type { PaperWidthMm, PrinterRole } from '../../contract/types';

import { EscPosBuilder } from '../escpos/builder';
import { columnsFor } from '../escpos/layout';
import { formatPrintedDateTimeAt, printerRoleLabel } from './format';

export const TEST_PAGE_SAMPLE = 'Niño Peña é ₱';

const LABEL_WIDTH = 9;

/** What a test page describes: a saved printer, or the one being edited. */
export type TestPageTarget = {
  name: string;
  role: PrinterRole;
  host: string;
  port: number;
  paper_width_mm: PaperWidthMm;
};

/** Two ruler lines: the tens digit every 10 columns, then the units digit of every column. */
export function columnRuler(columns: number): [string, string] {
  let tens = '';
  let units = '';
  for (let column = 1; column <= columns; column += 1) {
    tens += column % 10 === 0 ? String((column / 10) % 10) : ' ';
    units += String(column % 10);
  }
  return [tens.trimEnd(), units];
}

export function buildTestPage(target: TestPageTarget, options: { timeZone: string; now: number }): Uint8Array {
  const columns = columnsFor(target.paper_width_mm);
  const builder = new EscPosBuilder(columns).init();
  builder.align('center').bold(true).line('TEST PRINT').bold(false).align('left');
  builder
    .keyValue('Printer', target.name.trim() === '' ? '(not named yet)' : target.name, LABEL_WIDTH)
    .keyValue('Role', printerRoleLabel(target.role), LABEL_WIDTH)
    .keyValue('Address', `${target.host}:${target.port}`, LABEL_WIDTH)
    .keyValue('Paper', `${target.paper_width_mm} mm, ${columns} columns`, LABEL_WIDTH)
    .divider()
    .lines(columnRuler(columns))
    .divider()
    .line(TEST_PAGE_SAMPLE)
    .keyValue('Time', formatPrintedDateTimeAt(options.now, options.timeZone), LABEL_WIDTH);
  return builder.cut().build();
}
