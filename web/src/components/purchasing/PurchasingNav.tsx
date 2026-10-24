/**
 * The Purchasing module's pages (§L): Purchase requests, Purchase orders and,
 * for `purchase.receive`, Receiving. Suppliers is its own sidebar module.
 */
import { SubNav, type SubNavLink } from '@/components/common/SubNav';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';

export function PurchasingNav() {
  const { canReceive } = usePurchasingPermissions();
  const links: SubNavLink[] = [
    { to: '/purchasing/requests', label: 'Purchase requests', end: false },
    { to: '/purchasing/orders', label: 'Purchase orders', end: false },
  ];
  if (canReceive) links.push({ to: '/purchasing/receiving', label: 'Receiving', end: false });
  return <SubNav label="Purchasing" links={links} />;
}
