import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { printingKeys } from '@/hooks/printers/queryKeys';
import { printSample, type DirectPrintResult } from '@/printing/printActions';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { getBranchSettings, updateBranchSettings } from '@/services/settings';
import type { BranchSettings, BranchSettingsUpdateRequest } from '@/services/types';
import { requestPrintConfigSync } from '@/sync/printConfigSync';

/** Contract: up to 6 lines of up to 48 characters; copies 1–3. */
export const RECEIPT_LIMITS = { maxLines: 6, lineLength: 48, minCopies: 1, maxCopies: 3 } as const;

export type ReceiptSettingsValues = {
  headerLines: string[];
  footerLines: string[];
  autoPrint: boolean;
  copies: number;
  kitchenTickets: boolean;
};

export type LinesErrors = {
  /** A message for the whole list (e.g. too many lines). */
  list: string | null;
  /** A message per line, by index. */
  lines: Record<number, string>;
};

export type ReceiptSettingsErrors = {
  header: LinesErrors;
  footer: LinesErrors;
  autoPrint: string | null;
  copies: string | null;
  kitchenTickets: string | null;
};

const NO_ERRORS: ReceiptSettingsErrors = {
  header: { list: null, lines: {} },
  footer: { list: null, lines: {} },
  autoPrint: null,
  copies: null,
  kitchenTickets: null,
};

export const SETTINGS_SAVED_MESSAGE = 'Receipt settings saved. This tablet prints with them from now on.';
export const NOTHING_TO_SAVE_MESSAGE = 'Nothing changed.';

export function settingsToValues(settings: BranchSettings): ReceiptSettingsValues {
  return {
    headerLines: [...settings.receipt_header_lines],
    footerLines: [...settings.receipt_footer_lines],
    autoPrint: settings.auto_print_receipt,
    copies: settings.receipt_copies,
    kitchenTickets: settings.print_kitchen_tickets,
  };
}

function validateLines(lines: readonly string[]): LinesErrors {
  const errors: LinesErrors = { list: null, lines: {} };
  if (lines.length > RECEIPT_LIMITS.maxLines) errors.list = `Use up to ${RECEIPT_LIMITS.maxLines} lines.`;
  lines.forEach((line, index) => {
    const text = line.trim();
    if (text === '') errors.lines[index] = 'Enter text, or remove this line.';
    else if (text.length > RECEIPT_LIMITS.lineLength) errors.lines[index] = `Use ${RECEIPT_LIMITS.lineLength} characters or fewer.`;
  });
  return errors;
}

function hasErrors(errors: ReceiptSettingsErrors): boolean {
  const lineErrors = (group: LinesErrors) => group.list !== null || Object.keys(group.lines).length > 0;
  return lineErrors(errors.header) || lineErrors(errors.footer) || errors.copies !== null;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** Only what changed (PATCH is partial). Lines are trimmed. */
export function diffSettings(saved: BranchSettings, values: ReceiptSettingsValues): BranchSettingsUpdateRequest {
  const header = values.headerLines.map((line) => line.trim());
  const footer = values.footerLines.map((line) => line.trim());
  const changes: BranchSettingsUpdateRequest = {};
  if (!sameLines(header, saved.receipt_header_lines)) changes.receipt_header_lines = header;
  if (!sameLines(footer, saved.receipt_footer_lines)) changes.receipt_footer_lines = footer;
  if (values.autoPrint !== saved.auto_print_receipt) changes.auto_print_receipt = values.autoPrint;
  if (values.copies !== saved.receipt_copies) changes.receipt_copies = values.copies;
  if (values.kitchenTickets !== saved.print_kitchen_tickets) changes.print_kitchen_tickets = values.kitchenTickets;
  return changes;
}

/** A 422 as per-field messages (`receipt_header_lines.2` → header line 2). Unmatched keys → `null` (banner). */
export function mapSettingsErrors(errors: Record<string, string[]>): ReceiptSettingsErrors | null {
  const mapped: ReceiptSettingsErrors = {
    header: { list: null, lines: {} },
    footer: { list: null, lines: {} },
    autoPrint: null,
    copies: null,
    kitchenTickets: null,
  };
  let matched = false;
  for (const [key, messages] of Object.entries(errors)) {
    const message = messages[0];
    if (!message) continue;
    const line = /^receipt_(header|footer)_lines(?:\.(\d+))?$/.exec(key);
    if (line) {
      const group = line[1] === 'header' ? mapped.header : mapped.footer;
      if (line[2] === undefined) group.list = message;
      else group.lines[Number(line[2])] = message;
      matched = true;
    } else if (key === 'auto_print_receipt') {
      mapped.autoPrint = message;
      matched = true;
    } else if (key === 'receipt_copies') {
      mapped.copies = message;
      matched = true;
    } else if (key === 'print_kitchen_tickets') {
      mapped.kitchenTickets = message;
      matched = true;
    }
  }
  return matched ? mapped : null;
}

/** GET /api/v1/admin/settings. */
export function useBranchSettings() {
  return useQuery({ queryKey: printingKeys.settings(), queryFn: getBranchSettings });
}

/**
 * Receipt settings (`settings.manage`): header and footer lines, auto-print,
 * copies (1–3) and kitchen tickets, saved with PATCH /api/v1/admin/settings
 * (changed fields only). Saving syncs the print config. **Print sample**
 * prints the lines being edited on this tablet's receipt printer.
 */
export function useReceiptSettingsForm(initial: BranchSettings) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<ReceiptSettingsValues>(() => settingsToValues(initial));
  const [errors, setErrors] = useState<ReceiptSettingsErrors>(NO_ERRORS);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [sample, setSample] = useState<DirectPrintResult | null>(null);
  const inFlight = useRef(false);

  function update(changes: Partial<ReceiptSettingsValues>) {
    setValues((current) => ({ ...current, ...changes }));
    setErrors(NO_ERRORS);
    setNotice(null);
  }

  async function submit() {
    if (inFlight.current) return;
    setBanner(null);
    setNotice(null);
    const found: ReceiptSettingsErrors = {
      ...NO_ERRORS,
      header: validateLines(values.headerLines),
      footer: validateLines(values.footerLines),
    };
    if (hasErrors(found)) {
      setErrors(found);
      return;
    }
    setErrors(NO_ERRORS);

    const changes = diffSettings(saved, values);
    if (Object.keys(changes).length === 0) {
      setNotice(NOTHING_TO_SAVE_MESSAGE);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      const next = await updateBranchSettings(changes);
      setSaved(next);
      setValues(settingsToValues(next));
      client.setQueryData(printingKeys.settings(), next);
      void requestPrintConfigSync();
      setNotice(SETTINGS_SAVED_MESSAGE);
    } catch (error) {
      const mapped = isApiValidationError(error) ? mapSettingsErrors(error.errors) : null;
      if (mapped) setErrors(mapped);
      else setBanner(getErrorMessage(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function runSample() {
    if (sampling) return;
    setSampling(true);
    setSample(null);
    try {
      setSample(
        await printSample({
          receipt_header_lines: values.headerLines.map((line) => line.trim()).filter((line) => line !== ''),
          receipt_footer_lines: values.footerLines.map((line) => line.trim()).filter((line) => line !== ''),
        }),
      );
    } finally {
      setSampling(false);
    }
  }

  return {
    values,
    errors,
    banner,
    notice,
    submitting,
    sampling,
    sample,
    setHeaderLines: (headerLines: string[]) => update({ headerLines }),
    setFooterLines: (footerLines: string[]) => update({ footerLines }),
    setAutoPrint: (autoPrint: boolean) => update({ autoPrint }),
    setCopies: (copies: number) => update({ copies }),
    setKitchenTickets: (kitchenTickets: boolean) => update({ kitchenTickets }),
    submit: () => void submit(),
    printSample: () => void runSample(),
  };
}

export type ReceiptSettingsFormState = ReturnType<typeof useReceiptSettingsForm>;
