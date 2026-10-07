import { ShiftListScreen } from '@/components/shifts/ShiftListScreen';

/** Shifts: GET /api/v1/shifts (`report.zread`), with a business-date filter. */
export default function ShiftsIndexRoute() {
  return <ShiftListScreen />;
}
