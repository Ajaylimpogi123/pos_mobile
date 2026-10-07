import { StyleSheet, Text, View } from 'react-native';

import { PrintJobRows } from '@/components/printing/PrintJobRows';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { colors, spacing, typography } from '@/constants/theme';
import type { ReprintChoice, ReprintState } from '@/hooks/orders/useReprint';

type ReprintStatusCardProps = {
  reprint: ReprintState;
};

const REPRINT_TITLES: Record<ReprintChoice, string> = {
  receipt: 'Receipt reprint',
  kitchen: 'Kitchen ticket reprint',
  void_slip: 'Void slip reprint',
  refund_slip: 'Refund slip reprint',
};

/** The last reprint's progress: one row per job, or why nothing was sent. */
export function ReprintStatusCard({ reprint }: ReprintStatusCardProps) {
  const { result, jobs } = reprint;
  if (!result) return null;

  return (
    <Card style={styles.card} testID="reprint-status">
      <Text style={styles.title} accessibilityRole="header">
        {REPRINT_TITLES[result.kind]}
      </Text>
      {result.notice ? <Banner variant="warning" message={result.notice} testID="reprint-notice" /> : null}
      <PrintJobRows jobs={jobs} testID="reprint-job" />
      {result.unrouted.length > 0 ? (
        <View style={styles.unrouted} testID="reprint-unrouted">
          <Text style={styles.muted}>Not sent to any printer:</Text>
          {result.unrouted.map((line, index) => (
            <Text key={`${line}-${index}`} style={styles.line}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  unrouted: {
    gap: spacing.xxs,
  },
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  line: {
    ...typography.bodySm,
    color: colors.text,
  },
});
