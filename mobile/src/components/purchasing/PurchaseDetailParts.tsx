import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FormSection } from '@/components/shared/FormSection';
import { Card } from '@/components/ui/Card';
import { colors, layout, numeric, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type RecordHeaderCardProps = {
  /** `PR-MAIN-2026-00014`. */
  title: string;
  /** `Requested by Jon Dela Cruz · 29 Sep 2026, 4:45 PM · Needed by 2 Oct 2026`. */
  meta: string;
  metaTestID?: string;
  /** The status chip(s), top right (wrap under the title on narrow screens). */
  chips: ReactNode;
  /** Detail rows under the meta line (remarks, links, totals). */
  children?: ReactNode;
  testID: string;
};

/**
 * The head of a PR / PO detail (Sage "Purchasing" board): the number in bold,
 * a muted meta line (who, when, dates), the status chip on the right, and the
 * record's details below.
 */
export function RecordHeaderCard({ title, meta, metaTestID, chips, children, testID }: RecordHeaderCardProps) {
  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.headRow}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.meta} testID={metaTestID}>
            {meta}
          </Text>
        </View>
        <View style={styles.chips}>{chips}</View>
      </View>
      {children}
    </Card>
  );
}

/** A label / value line (e.g. `Approved so far ₱2,400.00`) of a summary card. */
export function SummaryLine({ label, value, strong, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/** A hairline between summary lines. */
export function SummaryDivider() {
  return <View style={styles.divider} />;
}

/** A soft (background-tinted) side card: a section label, lines and a note. */
export function SummaryCard({ title, children, note, testID }: { title: string; children: ReactNode; note?: string; testID?: string }) {
  return (
    <FormSection title={title} style={styles.summary} testID={testID}>
      <View style={styles.summaryLines}>{children}</View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </FormSection>
  );
}

/**
 * The bottom of a detail: the timeline (and receipts) beside a summary card on
 * tablet landscape, stacked elsewhere. Each pane keeps its tree position in
 * both layouts, so rotating only restyles.
 */
export function DetailColumns({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  const { isTwoPane, gutter } = useResponsive();
  return (
    <View style={[isTwoPane ? styles.columns : styles.stack, { gap: gutter }]}>
      <View style={[isTwoPane ? styles.mainPane : styles.full, { gap: gutter }]}>{main}</View>
      <View style={isTwoPane ? styles.asidePane : styles.full}>{aside}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  headRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headText: {
    flex: 1,
    minWidth: layout.sectionTitleMinWidth * 2,
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  lineLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  lineValue: {
    ...typography.label,
    ...numeric,
    color: colors.text,
    textAlign: 'right',
  },
  lineStrong: {
    ...typography.controlStrong,
    ...numeric,
  },
  divider: {
    height: sizes.borderWidth,
    backgroundColor: colors.border,
  },
  summary: {
    backgroundColor: colors.subtle,
  },
  summaryLines: {
    gap: spacing.sm,
  },
  note: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stack: {
    flexDirection: 'column',
  },
  mainPane: {
    flex: layout.mainPaneFlex,
    minWidth: 0,
  },
  asidePane: {
    flex: layout.asidePaneFlex,
    minWidth: 0,
  },
  full: {
    width: '100%',
  },
});
