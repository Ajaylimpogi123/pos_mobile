/**
 * The `Products | Ingredients` switch of the Inventory pages (§L), like the
 * tablet's `InventoryKindSwitch`: two links on the MASTER §3 tabs track.
 */
import { SubNav } from '@/components/common/SubNav';

const LINKS = [
  { to: '/inventory', label: 'Products' },
  { to: '/inventory/ingredients', label: 'Ingredients' },
] as const;

export function InventoryKindSwitch() {
  return <SubNav label="Inventory kind" links={LINKS} />;
}
