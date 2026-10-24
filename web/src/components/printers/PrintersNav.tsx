/** The Printers & settings sub-navigation (two pages under one module), on the shared SubNav track. */
import { SubNav, type SubNavLink } from '@/components/common/SubNav';

const LINKS: readonly SubNavLink[] = [
  { to: '/printers', label: 'Printers', end: true },
  { to: '/printers/receipt-settings', label: 'Receipt settings', end: false },
];

export function PrintersNav() {
  return <SubNav label="Printers and settings" links={LINKS} />;
}
