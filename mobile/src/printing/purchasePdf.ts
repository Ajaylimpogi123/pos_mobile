/**
 * Purchase Request & Order PDF, revision 2 (v1.27 §G): hands the A4 HTML from
 * `@pos/core/purchasing/printHtml` to the device.
 * - **Print / Save as PDF:** Android's print screen (`Print.printAsync`).
 * - **Share:** `Print.printToFileAsync`, the file renamed to `<number>.pdf`
 *   in the cache (`expo-file-system`), then the share sheet (`expo-sharing`).
 *
 * `expo-print` is a native module that needs the new EAS dev build. It is
 * loaded lazily (as `@/utils/csvShare` does), so an older build shows a clear
 * message instead of crashing. Never rejects.
 */
import { Platform } from 'react-native';

import { loadShareModules, type ShareModules } from '@/utils/csvShare';
import { A4_PAGE_POINTS, printFileName } from '@pos/core/purchasing/printHtml';

type PrintModule = typeof import('expo-print');

export const PDF_NEEDS_BUILD_MESSAGE = 'PDFs need the latest POS app build. Install the new dev build to print or share PDFs.';
export const PDF_WEB_MESSAGE = 'Use the web POS to print this document from a browser.';
export const PDF_PRINT_FAILED_MESSAGE = "The print screen couldn't open. Try again.";
export const PDF_FILE_FAILED_MESSAGE = "The PDF couldn't be saved on this tablet. Try again.";
export const PDF_SHARE_UNAVAILABLE_MESSAGE = "This device can't share files.";

export type PdfResult = { ok: true } | { ok: false; message: string };

/** `expo-print`, or `null` when this build doesn't have it. */
export function loadPrintModule(): PrintModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const print = require('expo-print') as PrintModule;
    if (typeof print.printAsync !== 'function' || typeof print.printToFileAsync !== 'function') return null;
    return print;
  } catch {
    return null;
  }
}

export type PdfDeps = {
  platform: string;
  loadPrint: () => PrintModule | null;
  loadShare: () => ShareModules | null;
};

const defaultDeps = (): PdfDeps => ({ platform: Platform.OS, loadPrint: loadPrintModule, loadShare: loadShareModules });

/** Opens the system print screen (a printer, or "Save as PDF"). */
export async function printPdf(html: string, deps: Partial<PdfDeps> = {}): Promise<PdfResult> {
  const { platform, loadPrint } = { ...defaultDeps(), ...deps };
  if (platform === 'web') return { ok: false, message: PDF_WEB_MESSAGE };
  const print = loadPrint();
  if (!print) return { ok: false, message: PDF_NEEDS_BUILD_MESSAGE };
  try {
    await print.printAsync({ html, width: A4_PAGE_POINTS.width, height: A4_PAGE_POINTS.height });
    return { ok: true };
  } catch {
    return { ok: false, message: PDF_PRINT_FAILED_MESSAGE };
  }
}

/** Renders the PDF, names it after the document number and opens the share sheet. */
export async function sharePdf(html: string, number: string, deps: Partial<PdfDeps> = {}): Promise<PdfResult> {
  const { platform, loadPrint, loadShare } = { ...defaultDeps(), ...deps };
  if (platform === 'web') return { ok: false, message: PDF_WEB_MESSAGE };
  const print = loadPrint();
  const share = loadShare();
  if (!print || !share) return { ok: false, message: PDF_NEEDS_BUILD_MESSAGE };

  let uri: string;
  try {
    const result = await print.printToFileAsync({ html, width: A4_PAGE_POINTS.width, height: A4_PAGE_POINTS.height });
    const { File, Paths } = share.fileSystem;
    const source = new File(result.uri);
    const target = new File(Paths.cache, printFileName(number));
    if (target.exists) target.delete();
    await source.move(target);
    uri = source.uri;
  } catch {
    return { ok: false, message: PDF_FILE_FAILED_MESSAGE };
  }

  try {
    if (!(await share.sharing.isAvailableAsync())) return { ok: false, message: PDF_SHARE_UNAVAILABLE_MESSAGE };
    await share.sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Share ${number}` });
    return { ok: true };
  } catch {
    return { ok: false, message: PDF_SHARE_UNAVAILABLE_MESSAGE };
  }
}
