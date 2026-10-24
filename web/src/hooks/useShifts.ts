/**
 * The shift history (`report.zread`; Shifts & Reporting → GET /shifts and
 * GET /shifts/{ulid}): the cursor list with the contract's filters
 * (`business_date`, `status`, `device_id`), and one shift's detail with the
 * server's report.
 */
import { useQuery } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage } from '@/services/api';
import { getShift, listShifts } from '@/services/shifts';
import type { ShiftStatus } from '@/services/types';

export type ShiftFilters = {
  businessDate: string | null;
  status: ShiftStatus | null;
  deviceId: number | null;
};

export const shiftListKeys = {
  list: (filters: ShiftFilters) => ['shifts', 'list', filters] as const,
  detail: (ulid: string) => ['shifts', 'detail', ulid] as const,
};

export function useShiftList(filters: ShiftFilters, options: { enabled?: boolean } = {}) {
  return useCursorList(
    shiftListKeys.list(filters),
    (cursor) =>
      listShifts({
        cursor,
        per_page: 25,
        business_date: filters.businessDate ?? undefined,
        status: filters.status ?? undefined,
        device_id: filters.deviceId ?? undefined,
      }),
    options,
  );
}

export function useShiftDetail(ulid: string | null) {
  const query = useQuery({
    queryKey: shiftListKeys.detail(ulid ?? ''),
    queryFn: () => getShift(ulid as string),
    enabled: ulid !== null,
  });
  return {
    shift: query.data ?? null,
    loading: ulid !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}
