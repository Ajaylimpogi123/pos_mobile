import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, sizes, spacing, typography } from '@/constants/theme';
import { jobLabel } from '@/printing/labels';
import { retryJob } from '@/printing/printActions';
import type { PrintJobView } from '@/stores/printing';

type PrintJobRowsProps = {
  jobs: readonly PrintJobView[];
  testID: string;
};

function JobRow({ job, first, testID }: { job: PrintJobView; first: boolean; testID: string }) {
  const label = jobLabel(job);
  const busy = job.status === 'pending' || job.status === 'printing';
  let statusWord = "Didn't print";
  if (busy) statusWord = 'Sending';
  else if (job.status === 'sent') statusWord = 'Sent';

  let status;
  if (busy) {
    status = (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={colors.primaryBright} />
        <Text style={styles.statusText}>Sending…</Text>
      </View>
    );
  } else if (job.status === 'sent') {
    // Port 9100 never confirms a print: "Sent", never "Printed".
    status = (
      <View style={styles.status}>
        <Icon name="checkmark-circle" size={iconSizes.sm} color={colors.success} />
        <Text style={[styles.statusText, styles.sent]}>Sent</Text>
      </View>
    );
  } else {
    status = (
      <View style={styles.status}>
        <Icon name="alert-circle" size={iconSizes.sm} color={colors.danger} />
        <Text style={[styles.statusText, styles.failed]}>Didn&apos;t print</Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, !first && styles.divider]} testID={`${testID}-${job.id}`}>
      <View style={styles.top}>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={2}>
            {label}
          </Text>
          <Text style={styles.printer} numberOfLines={1}>
            {job.printerName}
          </Text>
        </View>
        <View testID={`${testID}-${job.id}-status`} accessible accessibilityLabel={`${label}: ${statusWord}`}>
          {status}
        </View>
      </View>
      {job.status === 'failed' ? (
        <View style={styles.failure}>
          <Text style={styles.error} testID={`${testID}-${job.id}-error`}>
            {job.error}
          </Text>
          <Button
            title="Retry"
            leftIcon="refresh"
            variant="tonal"
            onPress={() => void retryJob(job.id)}
            style={styles.retry}
            accessibilityLabel={`Retry ${label}`}
            testID={`${testID}-${job.id}-retry`}
          />
        </View>
      ) : null}
    </View>
  );
}

/** One status row per print job: "Sending…", "Sent", or failed with the reason and Retry. */
export function PrintJobRows({ jobs, testID }: PrintJobRowsProps) {
  if (jobs.length === 0) return null;
  return (
    <View testID={testID}>
      {jobs.map((job, index) => (
        <JobRow key={job.id} job={job} first={index === 0} testID={testID} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  printer: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusText: {
    ...typography.captionStrong,
    color: colors.textSecondary,
  },
  sent: {
    color: colors.successText,
  },
  failed: {
    color: colors.dangerText,
  },
  failure: {
    gap: spacing.sm,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  retry: {
    alignSelf: 'flex-start',
  },
});
