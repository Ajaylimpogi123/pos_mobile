import { SellScreen } from '@/components/sell/SellScreen';

/** Sell (Phase 2, read-only): the on-device menu from SQLite (GET /api/v1/sync/catalogue keeps it current). */
export default function SellRoute() {
  return <SellScreen />;
}
