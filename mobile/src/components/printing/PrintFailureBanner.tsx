import { StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { failureSentence } from '@/printing/labels';
import { dismissJob, retryAllFailed, retryJob } from '@/printing/printActions';
import { selectFailedJobs, usePrintingStore } from '@/stores/printing';

/** At most this many failures are spelled out; the rest are counted. */
const MAX_LISTED = 3;

/**
 * The Sell screen's print failure banner (docs/api-contract.md → Printing →
 * Screens): "Kitchen ticket #17 didn't print: Kitchen isn't responding.
 * [Retry] [Dismiss]", or "Retry all" when several failed. Nothing when all is well.
 */
export function PrintFailureBanner() {
  const jobs = usePrintingStore((state) => state.jobs);
  const { screenPaddingX, contentMaxWidth } = useResponsive();
  const failed = selectFailedJobs(jobs);
  if (failed.length === 0) return null;

  const several = failed.length > 1;
  const message = several ? `${failed.length} print jobs didn't print.` : failureSentence(failed[0]);

  return (
    <View
      style={[styles.container, { paddingHorizontal: screenPaddingX, maxWidth: contentMaxWidth }]}
      testID="print-failure-banner"
    >
      <Banner variant="error" message={message} testID="print-failure-message" />
      {several ? (
        <View style={styles.list}>
          {failed.slice(0, MAX_LISTED).map((job) => (
            <Text key={job.id} style={styles.item}>
              • {failureSentence(job)}
            </Text>
          ))}
          {failed.length > MAX_LISTED ? <Text style={styles.item}>and {failed.length - MAX_LISTED} more</Text> : null}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          title={several ? 'Retry all' : 'Retry'}
          leftIcon="refresh"
          variant="tonal"
          onPress={() => void (several ? retryAllFailed() : retryJob(failed[0].id))}
          testID="print-failure-retry"
        />
        <Button
          title={several ? 'Dismiss all' : 'Dismiss'}
          variant="ghost"
          onPress={() => {
            for (const job of failed) void dismissJob(job.id);
          }}
          testID="print-failure-dismiss"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  list: {
    gap: spacing.xxs,
  },
  item: {
    ...typography.bodySm,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
