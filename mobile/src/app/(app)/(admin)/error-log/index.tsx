import { ErrorLogScreen } from '@/components/system/ErrorLogScreen';

/** The Error log: GET /api/v1/admin/error-log (`system.manage`). */
export default function ErrorLogIndexRoute() {
  return <ErrorLogScreen />;
}
