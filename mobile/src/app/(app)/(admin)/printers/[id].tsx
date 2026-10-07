import { useLocalSearchParams } from 'expo-router';

import { PrinterFormScreen } from '@/components/printers/PrinterFormScreen';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { ROUTES } from '@/constants/routes';
import { useAdminPrinter } from '@/hooks/printers/useAdminPrinters';
import { ApiError } from '@/services/api';
import { goBackOr } from '@/utils/navigation';
import { parseRouteId } from '@/utils/routeParams';

/** Edit printer: GET /api/v1/admin/printers/{id}, then the form (`settings.manage`). */
export default function EditPrinterRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const printerId = parseRouteId(id);
  const query = useAdminPrinter(printerId);

  if (query.data) return <PrinterFormScreen printer={query.data} />;

  const error = printerId === null ? new ApiError('This printer does not exist.', { status: 404, kind: 'http' }) : query.error;

  return (
    <RecordLoadState
      title="Edit printer"
      error={error}
      onRetry={() => void query.refetch()}
      onBack={() => goBackOr(ROUTES.printers)}
      testID="printer-load-state"
    />
  );
}
