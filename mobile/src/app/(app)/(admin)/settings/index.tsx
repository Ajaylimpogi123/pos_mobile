import { SettingsScreen } from '@/components/settings/SettingsScreen';

/**
 * Settings (`settings.manage`): the grouped sections (Receipt, Printers,
 * Staff, Customers, Log out). Receipt settings: GET and PATCH
 * /api/v1/admin/settings. `?section=receipt|printers` opens a section.
 */
export default function SettingsRoute() {
  return <SettingsScreen />;
}
