import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { timelineAction } from '@/components/purchasing/purchasingLabels';
import { FormSection } from '@/components/shared/FormSection';
import { colors, layout, radius, sizes, spacing, status, typography } from '@/constants/theme';
import type { PurchaseTimelineEntry } from '@/services/types';
import { formatBranchDateTime } from '@pos/core/businessDay';

/** The dot colour of an audit action: created grey, approved green, declined / cancelled red, received blue, edits grey. */
function dotColor(action: string): string {
  if (action.endsWith('.created')) return colors.textSecondary;
  if (action.endsWith('approved')) return status.completed.color;
  if (action.endsWith('declined') || action.endsWith('.cancelled')) return status.cancelled.color;
  if (action.endsWith('.received')) return status.processing.color;
  return colors.borderStrong;
}

type TimelineCardProps = {
  entries: readonly PurchaseTimelineEntry[];
  timeZone: string;
  style?: StyleProp<ViewStyle>;
  testID: string;
};

/**
 * The audit timeline of a PR or PO (§F/§G `timeline[]`, oldest first as the
 * server sends it): a coloured dot per entry (by its action), the action, who
 * and when, and the details (e.g. a decline reason), joined by a hairline.
 */
export const TimelineCard = memo(function TimelineCard({ entries, timeZone, style, testID }: TimelineCardProps) {
  return (
    <FormSection title="Timeline" style={style} testID={testID}>
      {entries.length === 0 ? <Text style={styles.muted}>No activity yet.</Text> : null}
      <View>
        {entries.map((entry, index) => {
          const action = timelineAction(entry.action);
          const when = formatBranchDateTime(entry.at, timeZone) ?? entry.at;
          const last = index === entries.length - 1;
          return (
            <View key={`${entry.at}-${entry.action}-${index}`} style={styles.row} testID={`${testID}-${index}`}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: dotColor(entry.action) }]} />
                {last ? null : <View style={styles.line} />}
              </View>
              <View style={[styles.text, !last && styles.textSpaced]}>
                <Text style={styles.label}>{action.label}</Text>
                <Text style={styles.muted}>{entry.by ? `${entry.by.name} · ${when}` : when}</Text>
                {entry.details ? (
                  <Text style={styles.details} testID={`${testID}-${index}-details`}>
                    {entry.details}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </FormSection>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rail: {
    width: layout.timelineDotSize,
    alignItems: 'center',
  },
  dot: {
    width: layout.timelineDotSize,
    height: layout.timelineDotSize,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  line: {
    flex: 1,
    width: sizes.borderWidth,
    marginTop: spacing.xs,
    backgroundColor: colors.border,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  textSpaced: {
    paddingBottom: spacing.md,
  },
  label: {
    ...typography.control,
    color: colors.text,
  },
  muted: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  details: {
    ...typography.bodySm,
    color: colors.text,
  },
});
