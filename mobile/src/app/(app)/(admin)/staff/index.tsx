import { StaffListScreen } from '@/components/staff/StaffListScreen';

/** Staff list: GET /api/v1/admin/users (search, role, active filters). */
export default function StaffIndexRoute() {
  return <StaffListScreen />;
}
