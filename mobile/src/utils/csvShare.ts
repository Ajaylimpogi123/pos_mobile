/**
 * Saves a CSV into the app's cache directory (`expo-file-system`) and opens
 * the share sheet (`expo-sharing`): Reports → **Export CSV**
 * (docs/api-contract.md → Shifts & Reporting → Screens). The HTTP part stays
 * in `@/services/reports` (the shared client); this only writes and shares.
 *
 * Both packages have native code, so they need a **new EAS dev build**. They
 * are loaded lazily: in a dev build made before them (no native module) or on
 * the web, export degrades to a clear message and the rest of the app keeps
 * working. (Expo Go bundles both modules, so export works there.)
 */
import { Platform } from 'react-native';

type FileSystemModule = typeof import('expo-file-system');
type SharingModule = typeof import('expo-sharing');

/** A dev build made before Phase 6 (no native file system or sharing module). */
export const EXPORT_NEEDS_BUILD_MESSAGE = 'Exporting needs the latest POS app build. Install the new dev build to export CSV files.';
/** The web (no local files to share). */
export const EXPORT_WEB_MESSAGE = 'CSV export works in the tablet app, not in a web browser.';
/** The device has no share sheet. */
export const EXPORT_UNAVAILABLE_MESSAGE = "This device can't share files.";
export const EXPORT_WRITE_MESSAGE = "The CSV file couldn't be saved on this tablet. Try again.";

/** Spreadsheets need the BOM to read UTF-8 (fetch drops it when decoding the body). */
const BOM = '﻿';

export type ShareModules = { fileSystem: FileSystemModule; sharing: SharingModule };

export type ShareResult = { ok: true; uri: string } | { ok: false; message: string };

/** The two modules, or `null` when this build doesn't have them. */
export function loadShareModules(): ShareModules | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fileSystem = require('expo-file-system') as FileSystemModule;
    const sharing = require('expo-sharing') as SharingModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (typeof fileSystem.File !== 'function' || !fileSystem.Paths || typeof sharing.shareAsync !== 'function') return null;
    return { fileSystem, sharing };
  } catch {
    // `requireNativeModule` throws at import when the build has no such module.
    return null;
  }
}

export type ShareCsvDeps = {
  platform: string;
  load: () => ShareModules | null;
};

/** The share sheet's title (Android) when none is given. */
export const DEFAULT_SHARE_TITLE = 'Export sales report';

export type ShareCsvOptions = Partial<ShareCsvDeps> & {
  /** The share sheet's title, e.g. `Export inventory report` (default `Export sales report`). */
  dialogTitle?: string;
};

/**
 * Writes `csv` to `<cache>/<fileName>` (replacing an older export of the
 * same name) and opens the share sheet. Never rejects.
 */
export async function shareCsv(fileName: string, csv: string, options: ShareCsvOptions = {}): Promise<ShareResult> {
  const { dialogTitle = DEFAULT_SHARE_TITLE, platform = Platform.OS, load = loadShareModules } = options;
  if (platform === 'web') return { ok: false, message: EXPORT_WEB_MESSAGE };
  const modules = load();
  if (!modules) return { ok: false, message: EXPORT_NEEDS_BUILD_MESSAGE };

  let uri: string;
  try {
    const file = new modules.fileSystem.File(modules.fileSystem.Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(csv.startsWith(BOM) ? csv : `${BOM}${csv}`);
    uri = file.uri;
  } catch {
    return { ok: false, message: EXPORT_WRITE_MESSAGE };
  }

  try {
    if (!(await modules.sharing.isAvailableAsync())) return { ok: false, message: EXPORT_UNAVAILABLE_MESSAGE };
    await modules.sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle,
    });
    return { ok: true, uri };
  } catch {
    return { ok: false, message: EXPORT_UNAVAILABLE_MESSAGE };
  }
}
