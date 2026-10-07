import { StyleSheet, View } from 'react-native';

import { PrintJobRows } from '@/components/printing/PrintJobRows';
import { Banner } from '@/components/ui/Banner';
import { spacing } from '@/constants/theme';
import { usePrintJobs } from '@/hooks/printing/usePrintJobs';

type ShiftPrintStatusProps = {
  jobIds: readonly string[];
  /** Why nothing was sent (no receipt printer, Expo Go, …). */
  notice: string | null;
  testID: string;
};

/** An X-read or Z-read's print status: "Sending…", "Sent", or failed with Retry; or why it couldn't print. */
export function ShiftPrintStatus({ jobIds, notice, testID }: ShiftPrintStatusProps) {
  const jobs = usePrintJobs(jobIds);
  if (!notice && jobs.length === 0) return null;
  return (
    <View style={styles.container} testID={testID}>
      {notice ? <Banner variant="warning" message={notice} testID={`${testID}-notice`} /> : null}
      <PrintJobRows jobs={jobs} testID={`${testID}-jobs`} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
});
