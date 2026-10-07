import { useLocalSearchParams } from 'expo-router';

import { ShiftDetailScreen } from '@/components/shifts/ShiftDetailScreen';

/** One shift: GET /api/v1/shifts/{ulid}, the server's `ShiftReport`, with Print. */
export default function ShiftRoute() {
  const params = useLocalSearchParams<{ ulid?: string | string[] }>();
  const ulid = Array.isArray(params.ulid) ? params.ulid[0] : params.ulid;
  return <ShiftDetailScreen ulid={ulid ?? null} />;
}
