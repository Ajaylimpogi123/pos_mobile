/**
 * Purchase Request & Order PDF, revision 2 (v1.27 §G): Print and Share glue
 * (`expo-print`, then the file renamed to `<number>.pdf` and shared).
 */
import {
  PDF_FILE_FAILED_MESSAGE,
  PDF_NEEDS_BUILD_MESSAGE,
  PDF_PRINT_FAILED_MESSAGE,
  printPdf,
  sharePdf,
} from '@/printing/purchasePdf';
import type { ShareModules } from '@/utils/csvShare';

function fakeModules() {
  const moved: string[] = [];
  class FakeFile {
    uri: string;
    exists = false;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    delete = jest.fn();
    async move(target: FakeFile) {
      moved.push(target.uri);
      this.uri = target.uri;
    }
  }
  const sharing = { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) };
  const share = { fileSystem: { File: FakeFile, Paths: { cache: { uri: 'file:///cache' } } }, sharing } as unknown as ShareModules;
  const print = {
    printAsync: jest.fn(async () => undefined),
    printToFileAsync: jest.fn(async () => ({ uri: 'file:///cache/Print/abc.pdf', numberOfPages: 1 })),
  };
  return { moved, sharing, share, print };
}

describe('printPdf', () => {
  it('opens the print screen on A4', async () => {
    const { print } = fakeModules();
    await expect(printPdf('<html></html>', { platform: 'android', loadPrint: () => print as never })).resolves.toEqual({ ok: true });
    expect(print.printAsync).toHaveBeenCalledWith({ html: '<html></html>', width: 595, height: 842 });
  });

  it('explains an old build and a failed print', async () => {
    await expect(printPdf('x', { platform: 'android', loadPrint: () => null })).resolves.toEqual({ ok: false, message: PDF_NEEDS_BUILD_MESSAGE });
    const { print } = fakeModules();
    print.printAsync.mockRejectedValueOnce(new Error('no'));
    await expect(printPdf('x', { platform: 'android', loadPrint: () => print as never })).resolves.toEqual({ ok: false, message: PDF_PRINT_FAILED_MESSAGE });
  });
});

describe('sharePdf', () => {
  it('renames the file to the document number and shares it', async () => {
    const { print, share, sharing, moved } = fakeModules();
    const result = await sharePdf('x', 'PO-MAIN-2026-00002', { platform: 'android', loadPrint: () => print as never, loadShare: () => share });
    expect(result).toEqual({ ok: true });
    expect(moved).toEqual(['file:///cache/PO-MAIN-2026-00002.pdf']);
    expect(sharing.shareAsync).toHaveBeenCalledWith('file:///cache/PO-MAIN-2026-00002.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
  });

  it('reports a file that could not be made', async () => {
    const { print, share } = fakeModules();
    print.printToFileAsync.mockRejectedValueOnce(new Error('disk'));
    await expect(sharePdf('x', 'PO-1', { platform: 'android', loadPrint: () => print as never, loadShare: () => share })).resolves.toEqual({
      ok: false,
      message: PDF_FILE_FAILED_MESSAGE,
    });
  });
});
