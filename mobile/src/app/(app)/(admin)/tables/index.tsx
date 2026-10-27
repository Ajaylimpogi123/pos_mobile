import { TablesScreen } from '@/components/tables/TablesScreen';

/**
 * Tables (Table Management §A): Board (`report.view`), Reservations
 * (`sale.create`), Floor plan and List (`settings.manage`), each shown by
 * permission. `?tab=` opens one of them.
 */
export default function TablesRoute() {
  return <TablesScreen />;
}
