import { InventoryListScreen } from '@/components/inventory/InventoryListScreen';

/** Inventory: GET /api/v1/inventory (`?status=alerts` opens the Low & out filter). */
export default function InventoryIndexRoute() {
  return <InventoryListScreen />;
}
