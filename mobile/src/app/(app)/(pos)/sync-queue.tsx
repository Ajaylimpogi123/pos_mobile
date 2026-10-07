import { SyncQueueScreen } from '@/components/sync/SyncQueueScreen';

/** Sync queue (Offline Sales, Phase 5): the sales saved on this tablet still to sync (needs `sale.create`; gated in `(pos)/_layout.tsx`). */
export default function SyncQueueRoute() {
  return <SyncQueueScreen />;
}
