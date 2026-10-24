import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardGrid, type GridEmptyProps } from '@/components/shared/CardGrid';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { ShiftEventCard } from '@/components/sync/ShiftEventCard';
import { SyncQueueCard } from '@/components/sync/SyncQueueCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { orderRoute } from '@/constants/routes';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { useSyncQueue, type SyncQueueEntry } from '@/hooks/sync/useSyncQueue';
import { useResponsive } from '@/hooks/useResponsive';

function openSale(ulid: string) {
  router.push(orderRoute(ulid));
}

function entryKey(entry: SyncQueueEntry): string {
  return entry.key;
}

/** Offline, when sales are waiting. */
export const QUEUE_OFFLINE_MESSAGE = 'This tablet is offline. The sales below sync by themselves when the connection is back.';

function summaryText(pending: number, attention: number): string {
  const parts: string[] = [];
  if (pending > 0) parts.push(`${pending} pending`);
  if (attention > 0) parts.push(`${attention} need${attention === 1 ? 's' : ''} attention`);
  return parts.length > 0 ? parts.join(' · ') : 'Every sale and shift event from this tablet has reached the server.';
}

/**
 * The Sync queue (`sale.create`), opened from the Sell header's status pill
 * (docs/api-contract.md → Offline Sales → Status pill): the sales saved on
 * this tablet that are **pending** or **need attention**, with **Sync now**
 * and a per-sale **Retry**. A card grid (1–3 columns from `useResponsive`),
 * with loading, empty, error-with-Retry and pull-to-refresh.
 */
export function SyncQueueScreen() {
  const queue = useSyncQueue();
  // Stable, so the memoized cards only re-render when their own entry changes.
  const retry = useLatestCallback(queue.retry);
  const { screenPaddingX } = useResponsive();

  const empty: GridEmptyProps = {
    title: 'Everything is synced',
    message: 'Sales and shift events saved on this tablet show here until they reach the server.',
    icon: 'cloud-done-outline',
  };

  const header = (
    <View style={styles.headerContent}>
      {queue.online ? null : <Banner variant="warning" message={QUEUE_OFFLINE_MESSAGE} testID="sync-queue-offline" />}
      {queue.online && queue.lastError && queue.pendingCount > 0 ? (
        <Banner variant="info" message={queue.lastError} testID="sync-queue-error" />
      ) : null}
    </View>
  );

  return (
    <Screen edges={[]} testID="sync-queue-screen">
      <ListHeader band subtitle="Offline sales on this tablet" title="Sync queue" testIDPrefix="sync-queue" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <ListToolbar testID="sync-queue-toolbar">
        <View style={[styles.toolbar, { paddingHorizontal: screenPaddingX }]}>
          <Text style={styles.summary} testID="sync-queue-summary">
            {summaryText(queue.pendingCount, queue.attentionCount)}
          </Text>
          <Button
            title="Sync now"
            leftIcon="sync"
            onPress={queue.syncNow}
            loading={queue.syncing}
            disabled={!queue.online || queue.syncing}
            style={styles.syncButton}
            testID="sync-queue-sync-now"
          />
        </View>
        </ListToolbar>
        <CardGrid
          items={queue.items}
          keyOf={entryKey}
          renderItem={(entry) =>
            entry.kind === 'sale' ? (
              <SyncQueueCard
                record={entry.record}
                retrying={queue.retrying[entry.key] ?? false}
                onRetry={retry}
                onOpen={openSale}
              />
            ) : (
              <ShiftEventCard event={entry.event} retrying={queue.retrying[entry.key] ?? false} onRetry={retry} />
            )
          }
          {...queue.grid}
          header={header}
          empty={empty}
          testID="sync-queue-grid"
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  toolbar: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  summary: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    minWidth: layout.sectionTitleMinWidth,
  },
  syncButton: {
    paddingHorizontal: spacing.xl,
  },
  headerContent: {
    gap: spacing.sm,
  },
});
