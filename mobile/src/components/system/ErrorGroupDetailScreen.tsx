import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionRow, toneVariant, ValueRow } from '@/components/device/DeviceParts';
import { InfoCard } from '@/components/shared/InfoCard';
import { ListHeader } from '@/components/shared/ListHeader';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Screen } from '@/components/ui/Screen';
import { colors, layout, radius, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import type { ClientErrorContext, ErrorEvent, ErrorGroupDetail } from '@/services/types';
import { formatClockTime, formatRelativeTime, formatShortDate } from '@/utils/dates';
import { ERROR_LEVEL_LABELS, ERROR_LEVEL_TONES, ERROR_SOURCE_LABELS, ERROR_STATUS_LABELS } from '@pos/core/errors/health';

function stamp(iso: string | null): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '—';
  return `${formatShortDate(new Date(time))} ${formatClockTime(iso) ?? ''}`.trim();
}

/** Context fields as label/value pairs (only the ones present). */
function contextRows(context: ClientErrorContext): [string, string][] {
  const rows: [string, string][] = [];
  if (context.screen) rows.push(['Screen', context.screen]);
  if (context.app_version) rows.push(['App version', context.app_version]);
  if (context.os || context.os_version) rows.push(['System', [context.os, context.os_version].filter(Boolean).join(' ')]);
  if (context.device_model) rows.push(['Model', context.device_model]);
  if (context.install_id) rows.push(['Install ID', `…${context.install_id.slice(-6)}`]);
  if (context.online !== null && context.online !== undefined) rows.push(['Online', context.online ? 'Yes' : 'No']);
  for (const [key, value] of Object.entries(context.extra ?? {})) rows.push([key, value]);
  return rows;
}

/** A stack trace in a monospace box that scrolls both ways. */
function StackBox({ stack, testID }: { stack: string; testID: string }) {
  return (
    <ScrollView style={styles.stackBox} nestedScrollEnabled testID={testID}>
      <ScrollView horizontal nestedScrollEnabled>
        <Text style={styles.stack} selectable>
          {stack}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}

function EventCard({ event, index }: { event: ErrorEvent; index: number }) {
  const rows = contextRows(event.context);
  return (
    <View style={styles.event} testID={`error-event-${index}`}>
      <Text style={styles.eventTitle}>{stamp(event.occurred_at)}</Text>
      <Text style={styles.muted}>
        {[event.device ? `${event.device.code} · ${event.device.name}` : null, event.user?.name ?? null].filter(Boolean).join(' · ') || 'Unknown device'}
      </Text>
      {event.message ? <Text style={styles.eventMessage}>{event.message}</Text> : null}
      {rows.map(([label, value]) => (
        <ValueRow key={label} label={label} value={value} />
      ))}
      {event.stack ? <StackBox stack={event.stack} testID={`error-event-${index}-stack`} /> : null}
    </View>
  );
}

type Props = {
  group: ErrorGroupDetail;
  toggling: boolean;
  actionError: string | null;
  onResolve: () => void;
  onReopen: () => void;
};

/**
 * One error group (Error log, `system.manage`): level, source and status, the
 * message, counts and versions, Resolve / Reopen, then its latest 50 events,
 * each with its context and the stack in a monospace scroll.
 */
export function ErrorGroupDetailScreen({ group, toggling, actionError, onResolve, onReopen }: Props) {
  const { screenPaddingX, screenPaddingY, contentMaxWidth, gutter } = useResponsive();
  const resolved = group.status === 'resolved';

  return (
    <Screen edges={[]} testID="error-group-screen">
      <ListHeader title="Error" subtitle={ERROR_SOURCE_LABELS[group.source]} testIDPrefix="error-group" />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.body}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY, maxWidth: contentMaxWidth, gap: gutter },
          ]}
        >
          {actionError ? <Banner message={actionError} testID="error-group-action-error" /> : null}
          <InfoCard title="Summary" icon="bug-outline" tone={resolved ? 'primary' : 'danger'} testID="error-group-summary">
            <View style={styles.chips}>
              <Chip label={ERROR_LEVEL_LABELS[group.level]} variant={toneVariant(ERROR_LEVEL_TONES[group.level])} size="sm" />
              <Chip label={ERROR_SOURCE_LABELS[group.source]} variant="neutral" size="sm" />
              <Chip label={ERROR_STATUS_LABELS[group.status]} variant={resolved ? 'success' : 'warning'} size="sm" testID="error-group-status" />
            </View>
            <Text style={styles.message} selectable testID="error-group-message">
              {group.message}
            </Text>
            <ValueRow label="Occurrences" value={group.occurrences.toLocaleString('en-US')} testID="error-group-occurrences" />
            <ValueRow label="First seen" value={stamp(group.first_seen_at)} />
            <ValueRow label="Last seen" value={formatRelativeTime(group.last_seen_at) ?? '—'} />
            <ValueRow label="App versions" value={group.app_versions.length > 0 ? group.app_versions.join(', ') : '—'} />
            {resolved ? (
              <ValueRow label="Resolved" value={[stamp(group.resolved_at), group.resolved_by?.name].filter(Boolean).join(' · ')} />
            ) : null}
            <ActionRow>
              {resolved ? (
                <Button title="Reopen" leftIcon="refresh" variant="secondary" loading={toggling} disabled={toggling} onPress={onReopen} testID="error-group-reopen" />
              ) : (
                <Button title="Mark resolved" leftIcon="checkmark-done" loading={toggling} disabled={toggling} onPress={onResolve} testID="error-group-resolve" />
              )}
            </ActionRow>
          </InfoCard>

          <InfoCard title={`Latest events (${group.events.length})`} icon="list-outline" tone="info" testID="error-group-events">
            {group.events.length === 0 ? <Text style={styles.muted}>No events kept for this error.</Text> : null}
            {group.events.map((event, index) => (
              <EventCard key={event.ulid} event={event} index={index} />
            ))}
          </InfoCard>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
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
  muted: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  event: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  eventTitle: {
    ...typography.label,
    color: colors.text,
  },
  eventMessage: {
    ...typography.bodySm,
    color: colors.text,
  },
  stackBox: {
    maxHeight: layout.stackMaxHeight,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  stack: {
    ...typography.mono,
    color: colors.text,
  },
});
