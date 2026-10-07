import { useEffect, useRef, useState } from 'react';

import { getErrorMessage, isApiValidationError } from '@/services/api';
import { shareCsv } from '@/utils/csvShare';

export type ExportMessage = { variant: 'error' | 'warning' | 'success'; text: string };

/**
 * **Export CSV** for a report: downloads the export of the current query,
 * saves it and opens the share sheet titled `dialogTitle`. A message belongs
 * to the query it was made for, so changing a filter clears it.
 */
export function useCsvExport<P>(
  params: P | null,
  download: (params: P) => Promise<{ fileName: string; csv: string }>,
  dialogTitle: string,
) {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ key: string; value: ExportMessage } | null>(null);
  const mounted = useRef(true);
  const key = JSON.stringify(params);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function exportCsv() {
    if (params === null || exporting) return;
    const forKey = key;
    setExporting(true);
    setMessage(null);
    try {
      const file = await download(params);
      const shared = await shareCsv(file.fileName, file.csv, { dialogTitle });
      if (!mounted.current) return;
      setMessage(shared.ok ? null : { key: forKey, value: { variant: 'warning', text: shared.message } });
    } catch (error) {
      if (!mounted.current) return;
      const text = isApiValidationError(error) ? (Object.values(error.errors)[0]?.[0] ?? error.message) : getErrorMessage(error);
      setMessage({ key: forKey, value: { variant: 'error', text } });
    } finally {
      if (mounted.current) setExporting(false);
    }
  }

  return {
    exporting,
    exportMessage: message && message.key === key ? message.value : null,
    exportCsv: () => void exportCsv(),
    dismissExportMessage: () => setMessage(null),
  };
}
