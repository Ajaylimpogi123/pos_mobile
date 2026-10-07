import { useState } from 'react';

import type { FieldErrors } from '@/hooks/forms/formErrors';
import { useRecordForm } from '@/hooks/forms/useRecordForm';
import { usePrinterMutations } from '@/hooks/printers/useAdminPrinters';
import { testPrint, type DirectPrintResult } from '@/printing/printActions';
import type { PaperWidthMm, Printer, PrinterCreateRequest, PrinterRole, PrinterUpdateRequest } from '@/services/types';

/** Request fields of POST/PATCH /api/v1/admin/printers that have an input. */
export type PrinterField =
  | 'name'
  | 'role'
  | 'host'
  | 'port'
  | 'paper_width_mm'
  | 'is_enabled'
  | 'is_default_kitchen'
  | 'category_ids';

export const PRINTER_FIELDS: readonly PrinterField[] = [
  'name',
  'role',
  'host',
  'port',
  'paper_width_mm',
  'is_enabled',
  'is_default_kitchen',
  'category_ids',
];

export type PrinterFormValues = {
  name: string;
  role: PrinterRole;
  host: string;
  port: string;
  paperWidth: PaperWidthMm;
  isEnabled: boolean;
  isDefaultKitchen: boolean;
  categoryIds: number[];
};

const FIELD_OF: { [K in keyof PrinterFormValues]: PrinterField } = {
  name: 'name',
  role: 'role',
  host: 'host',
  port: 'port',
  paperWidth: 'paper_width_mm',
  isEnabled: 'is_enabled',
  isDefaultKitchen: 'is_default_kitchen',
  categoryIds: 'category_ids',
};

/** Contract limits and defaults. */
export const PRINTER_LIMITS = { name: 40, host: 253, portMin: 1, portMax: 65535, defaultPort: 9100 } as const;

/** An IPv4 address or a hostname: letters, digits, hyphens and dots (no scheme, no port). */
const HOST_PATTERN = /^[A-Za-z0-9.-]+$/;

export function printerToValues(printer?: Printer): PrinterFormValues {
  return {
    name: printer?.name ?? '',
    role: printer?.role ?? 'kitchen',
    host: printer?.host ?? '',
    port: String(printer?.port ?? PRINTER_LIMITS.defaultPort),
    paperWidth: printer?.paper_width_mm ?? 80,
    isEnabled: printer?.is_enabled ?? true,
    isDefaultKitchen: printer?.is_default_kitchen ?? false,
    categoryIds: printer ? [...printer.category_ids] : [],
  };
}

/** The host check shared by Save and Test print. `null` when fine. */
export function hostError(host: string): string | null {
  const value = host.trim();
  if (value === '') return 'Enter the printer’s IP address, e.g. 192.168.1.60.';
  if (value.length > PRINTER_LIMITS.host) return `Use ${PRINTER_LIMITS.host} characters or fewer.`;
  if (!HOST_PATTERN.test(value)) return 'Enter only the IP address or host name, without http:// or a port.';
  return null;
}

/** The port as an integer 1–65535, or `null`. */
export function parsePort(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,5}$/.test(value)) return null;
  const port = Number(value);
  return port >= PRINTER_LIMITS.portMin && port <= PRINTER_LIMITS.portMax ? port : null;
}

export const PORT_MESSAGE = 'Enter a port from 1 to 65535 (usually 9100).';

export function validatePrinter(values: PrinterFormValues): { body: PrinterCreateRequest | null; errors: FieldErrors<PrinterField> } {
  const errors: FieldErrors<PrinterField> = {};
  const name = values.name.trim();
  if (name === '') errors.name = 'Enter a name, e.g. Kitchen.';
  else if (name.length > PRINTER_LIMITS.name) errors.name = `Use ${PRINTER_LIMITS.name} characters or fewer.`;

  const host = hostError(values.host);
  if (host) errors.host = host;
  const port = parsePort(values.port);
  if (port === null) errors.port = PORT_MESSAGE;

  if (Object.keys(errors).length > 0 || port === null) return { body: null, errors };

  const cashier = values.role === 'cashier';
  return {
    body: {
      name,
      role: values.role,
      host: values.host.trim(),
      port,
      paper_width_mm: values.paperWidth,
      is_enabled: values.isEnabled,
      // Receipt printers never take categories or the default kitchen flag.
      is_default_kitchen: cashier ? false : values.isDefaultKitchen,
      category_ids: cashier ? [] : [...new Set(values.categoryIds)].sort((a, b) => a - b),
    },
    errors,
  };
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Only the fields that differ from the saved printer (PATCH is partial). */
export function diffPrinter(saved: Printer, body: PrinterCreateRequest): PrinterUpdateRequest {
  const changes: PrinterUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if (body.role !== saved.role) changes.role = body.role;
  if (body.host !== saved.host) changes.host = body.host;
  if (body.port !== undefined && body.port !== saved.port) changes.port = body.port;
  if (body.paper_width_mm !== undefined && body.paper_width_mm !== saved.paper_width_mm) changes.paper_width_mm = body.paper_width_mm;
  if (body.is_enabled !== undefined && body.is_enabled !== saved.is_enabled) changes.is_enabled = body.is_enabled;
  if (body.is_default_kitchen !== undefined && body.is_default_kitchen !== saved.is_default_kitchen) {
    changes.is_default_kitchen = body.is_default_kitchen;
  }
  if (body.category_ids !== undefined && !sameIds(body.category_ids, saved.category_ids)) changes.category_ids = body.category_ids;
  return changes;
}

type UsePrinterFormOptions = {
  initial?: Printer;
  onSaved: () => void;
  onDeleted: () => void;
};

/**
 * Create / edit a printer (`settings.manage`): POST or PATCH (changed fields
 * only) /api/v1/admin/printers, and Delete. **Test print** sends the test page
 * to the host being edited, before saving.
 */
export function usePrinterForm({ initial, onSaved, onDeleted }: UsePrinterFormOptions) {
  const mutations = usePrinterMutations();
  const form = useRecordForm<PrinterFormValues, PrinterField, Printer, PrinterCreateRequest, PrinterUpdateRequest>({
    initial,
    toValues: printerToValues,
    validate: validatePrinter,
    diff: diffPrinter,
    fields: PRINTER_FIELDS,
    fieldOf: FIELD_OF,
    create: mutations.create,
    update: mutations.update,
    remove: mutations.remove,
    onSaved,
    onDeleted,
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DirectPrintResult | null>(null);

  async function runTestPrint() {
    if (testing) return;
    const { values } = form;
    const host = hostError(values.host);
    const port = parsePort(values.port);
    if (host || port === null) {
      form.setFieldErrors({ ...form.fieldErrors, ...(host ? { host } : {}), ...(port === null ? { port: PORT_MESSAGE } : {}) });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(
        await testPrint({ name: values.name, role: values.role, host: values.host.trim(), port, paper_width_mm: values.paperWidth }),
      );
    } finally {
      setTesting(false);
    }
  }

  return {
    ...form,
    testing,
    testResult,
    testPrint: () => void runTestPrint(),
  };
}

export type PrinterFormState = ReturnType<typeof usePrinterForm>;
