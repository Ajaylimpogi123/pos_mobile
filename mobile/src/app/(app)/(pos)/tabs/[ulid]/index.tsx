import { useLocalSearchParams } from 'expo-router';

import { TabScreen } from '@/components/tables/TabScreen';

/** A dine-in tab (Dine-in Tables & Tabs §D): GET /api/v1/tabs/{ulid}, the menu, the next round and the bill. */
export default function TabRoute() {
  const { ulid } = useLocalSearchParams<{ ulid: string }>();
  return <TabScreen ulid={typeof ulid === 'string' ? ulid : ''} />;
}
