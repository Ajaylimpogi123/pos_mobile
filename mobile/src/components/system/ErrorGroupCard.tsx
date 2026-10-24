import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { toneVariant } from '@/components/device/DeviceParts';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, pressedScale, spacing, typography } from '@/constants/theme';
import type { ErrorGroup } from '@/services/types';
import { formatRelativeTime } from '@/utils/dates';
import { ERROR_LEVEL_LABELS, ERROR_LEVEL_TONES, ERROR_SOURCE_LABELS, ERROR_STATUS_LABELS } from '@pos/core/errors/health';

/** Where the latest occurrence came from: device code, screen, version. */
export function latestLine(group: ErrorGroup): string {
  const parts = [
    group.latest.device ? group.latest.device.code : null,
    group.latest.screen,
    group.latest.app_version ? `v${group.latest.app_version}` : null,
    group.latest.user?.name ?? null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** An error group: level, source, status, the message, occurrences and when it was last seen. Tap to open. */
export const ErrorGroupCard = memo(function ErrorGroupCard({ group, onPress }: { group: ErrorGroup; onPress: (group: ErrorGroup) => void }) {
  const testID = `error-group-${group.id}`;
  const seen = formatRelativeTime(group.last_seen_at) ?? '';
  const where = latestLine(group);

  return (
    <Card style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${ERROR_LEVEL_LABELS[group.level]}, ${ERROR_SOURCE_LABELS[group.source]}: ${group.message}. ${group.occurrences} times, last ${seen}`}
        accessibilityHint="Opens the error"
        onPress={() => onPress(group)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`${testID}-open`}
      >
        <View style={styles.chips}>
          <Chip label={ERROR_LEVEL_LABELS[group.level]} variant={toneVariant(ERROR_LEVEL_TONES[group.level])} size="sm" testID={`${testID}-level`} />
          <Chip label={ERROR_SOURCE_LABELS[group.source]} variant="neutral" size="sm" />
          {group.status === 'resolved' ? <Chip label={ERROR_STATUS_LABELS.resolved} variant="success" size="sm" testID={`${testID}-resolved`} /> : null}
        </View>
        <Text style={styles.message} numberOfLines={3}>
          {group.message}
        </Text>
        <Text style={styles.meta}>
          {group.occurrences.toLocaleString('en-US')} {group.occurrences === 1 ? 'time' : 'times'} · last {seen.toLowerCase()}
        </Text>
        {where ? (
          <Text style={styles.meta} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </Pressable>
    </Card>
  );
});

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
  },
  body: {
    gap: spacing.sm,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  message: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  meta: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
});
