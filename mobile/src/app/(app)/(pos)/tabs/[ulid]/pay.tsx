import { useLocalSearchParams } from 'expo-router';

import { TabCheckoutScreen } from '@/components/tables/TabCheckoutScreen';

/** Paying a tab (Dine-in Tables & Tabs §D.6 and §E): POST /api/v1/tabs/{ulid}/settle. */
export default function TabPayRoute() {
  const { ulid } = useLocalSearchParams<{ ulid: string }>();
  return <TabCheckoutScreen ulid={typeof ulid === 'string' ? ulid : ''} />;
}
