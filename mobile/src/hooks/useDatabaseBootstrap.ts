import { useEffect } from 'react';

import { prepareDatabase } from '@/db/database';

/**
 * Opens the on-device database and runs its migrations once at app start,
 * alongside (never blocking) the session restore. The result lands in the
 * sync store; the Sell screen and the sync runner await the same promise.
 */
export function useDatabaseBootstrap(): void {
  useEffect(() => {
    void prepareDatabase();
  }, []);
}
