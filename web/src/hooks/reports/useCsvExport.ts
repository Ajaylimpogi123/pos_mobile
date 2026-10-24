/**
 * **Export CSV** for a report: downloads the export of the current query
 * through the API client (Bearer header, never a token in the URL) and saves
 * it under the server's file name. A 422 (e.g. the range is too long) shows
 * its field message; a 403 or any other error shows the server's message.
 * A message belongs to the query it was made for, so changing a filter clears it.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getErrorMessage, isApiValidationError } from '@/services/api';
import type { ReportFile } from '@/services/reports';
import { saveBlob } from '@/utils/download';

export function useCsvExport<P>(params: P | null, download: (params: P) => Promise<ReportFile>) {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ key: string; text: string } | null>(null);
  const mounted = useRef(true);
  const key = JSON.stringify(params);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run() {
    if (params === null || exporting) return;
    const forKey = key;
    setExporting(true);
    setMessage(null);
    try {
      const file = await download(params);
      saveBlob(file.blob, file.fileName);
      toast.success(`Downloaded ${file.fileName}`);
    } catch (error) {
      if (!mounted.current) return;
      const text = isApiValidationError(error) ? (Object.values(error.errors)[0]?.[0] ?? error.message) : getErrorMessage(error);
      setMessage({ key: forKey, text });
    } finally {
      if (mounted.current) setExporting(false);
    }
  }

  return {
    exporting,
    exportError: message && message.key === key ? message.text : null,
    exportCsv: () => void run(),
    dismissExportError: () => setMessage(null),
  };
}
