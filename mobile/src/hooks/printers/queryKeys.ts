/**
 * TanStack Query keys for printers and receipt settings (Printing, Phase 4).
 * Everything lives under `['admin', 'printing']`; a sign-out clears the cache anyway.
 */
const root = ['admin', 'printing'] as const;

export const printingKeys = {
  all: root,
  printers: () => [...root, 'printers'] as const,
  printerList: () => [...root, 'printers', 'list'] as const,
  printer: (id: number) => [...root, 'printers', 'detail', id] as const,
  settings: () => [...root, 'settings'] as const,
};
