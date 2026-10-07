import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { IconName } from '@/components/ui/Icon';
import { IconBadge } from '@/components/ui/IconBadge';
import { Skeleton, SkeletonPulse } from '@/components/ui/Skeleton';
import { colors, layout, radius, sizes, spacing, typography } from '@/constants/theme';
import { getErrorMessage, isApiError } from '@/services/api';

type ReportStatusCardProps =
  | { kind: 'loading'; testID: string }
  | { kind: 'error'; error: unknown; onRetry: () => void; testID: string; retryTestID?: string }
  | { kind: 'empty'; icon: IconName; title: string; message: string; actionLabel?: string; onAction?: () => void; testID: string; actionTestID?: string };

const SKELETON_CARDS = ['a', 'b', 'c', 'd', 'e'] as const;

/** A report's loading (skeleton total cards; the table shows skeleton rows), error (403 → "No access", Retry) or empty card, as the Sales and Inventory views show them. */
export function ReportStatusCard(props: ReportStatusCardProps) {
  if (props.kind === 'loading') {
    return (
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading the report…" testID={props.testID}>
        <SkeletonPulse style={styles.skeletons}>
          {SKELETON_CARDS.map((key) => (
            <View key={key} style={styles.skeleton}>
              <Skeleton width="50%" />
              <Skeleton width="70%" height={sizes.skeleton.lineLarge} />
            </View>
          ))}
        </SkeletonPulse>
      </View>
    );
  }
  if (props.kind === 'error') {
    const noAccess = isApiError(props.error) && props.error.status === 403;
    return (
      <Card style={styles.card} testID={props.testID}>
        <IconBadge icon={noAccess ? 'lock-closed-outline' : 'cloud-offline-outline'} tone="danger" />
        <Text style={styles.title}>{noAccess ? 'No access' : "Couldn't load the report"}</Text>
        <Text style={styles.text}>{getErrorMessage(props.error)}</Text>
        <Button title="Retry" leftIcon="refresh" variant="secondary" onPress={props.onRetry} testID={props.retryTestID ?? `${props.testID}-retry`} />
      </Card>
    );
  }
  return (
    <Card style={styles.card} testID={props.testID}>
      <IconBadge icon={props.icon} />
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.text}>{props.message}</Text>
      {props.actionLabel && props.onAction ? (
        <Button title={props.actionLabel} variant="secondary" onPress={props.onAction} testID={props.actionTestID ?? `${props.testID}-action`} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  skeletons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  skeleton: {
    flexGrow: 1,
    flexBasis: layout.reportNumberColumnWidth + spacing.giant + spacing.lg,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  card: {
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    textAlign: 'center',
  },
  text: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
