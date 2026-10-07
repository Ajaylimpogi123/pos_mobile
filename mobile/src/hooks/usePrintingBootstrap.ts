import { useEffect } from 'react';

import { loadCachedPrintConfig, startPrinting } from '@/printing/printActions';
import { useSessionStore } from '@/stores/session';

/**
 * Printing at app start (docs/api-contract.md → Printing → Queue, Config),
 * mounted once in the root layout:
 * - startup recovery (jobs left `pending` or `printing` become `failed`,
 *   never reprinted silently), pruning, and this tablet's receipt printer choice;
 * - the cached print config of the signed-in user's branch (again whenever a
 *   user of another branch signs in). The config sync itself runs on the
 *   catalogue-sync triggers (`useCatalogueSyncTriggers`).
 */
export function usePrintingBootstrap(): void {
  const branchId = useSessionStore((state) => (state.status === 'signedIn' ? (state.user?.branch.id ?? null) : null));

  useEffect(() => {
    void startPrinting();
  }, []);

  useEffect(() => {
    if (branchId !== null) void loadCachedPrintConfig(branchId);
  }, [branchId]);
}
