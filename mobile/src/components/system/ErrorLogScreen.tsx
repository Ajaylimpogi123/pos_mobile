import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toneVariant } from '@/components/device/DeviceParts';
import { CardGrid, type GridEmptyProps, type GridTable } from '@/components/shared/CardGrid';
import { ChipFilterRow } from '@/components/shared/ChipFilterRow';
import { ListFilters } from '@/components/shared/ListFilters';
import { ListHeader } from '@/components/shared/ListHeader';
import { ListToolbar } from '@/components/shared/ListToolbar';
import { ErrorGroupCard, latestLine } from '@/components/system/ErrorGroupCard';
import { Chip } from '@/components/ui/Chip';
import { CellText } from '@/components/ui/DataTable';
import { Screen } from '@/components/ui/Screen';
import { StatCard } from '@/components/ui/StatCard';
import type { SegmentOption } from '@/components/ui/SegmentedControl';
import { errorGroupRoute } from '@/constants/routes';
import { spacing } from '@/constants/theme';
import { useErrorLogScreen, type LevelFilter, type RangeFilter, type SourceFilter } from '@/hooks/system/useErrorLog';
import { useResponsive } from '@/hooks/useResponsive';
import type { ErrorGroup, ErrorGroupStatus } from '@/services/types';
import { formatRelativeTime } from '@/utils/dates';
import { ERROR_LEVEL_LABELS, ERROR_LEVEL_TONES, ERROR_SOURCE_LABELS, ERROR_STATUS_LABELS } from '@pos/core/errors/health';

const STATUSES: readonly SegmentOption<ErrorGroupStatus>[] = [
  { value: 'open', label: 'Open', testID: 'error-log-status-open' },
  { value: 'resolved', label: 'Resolved', testID: 'error-log-status-resolved' },
];

const SOURCES: readonly { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'App and server' },
  { value: 'app', label: 'App' },
  { value: 'server', label: 'Server' },
];

const LEVELS: readonly { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'Any level' },
  { value: 'fatal', label: 'Fatal' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
];

const RANGES: readonly { value: RangeFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function keyOf(group: ErrorGroup): string {
  return String(group.id);
}

function open(group: ErrorGroup) {
  router.push(errorGroupRoute(group.id));
}

function rowTestID(group: ErrorGroup): string {
  return `error-group-${group.id}`;
}

/** The table (tablets in landscape): level, source and status, the message, occurrences and last seen, where. Test IDs match the card's. */
function useErrorTable(): GridTable<ErrorGroup> {
  return useMemo(
    () => ({
      columns: [
        {
          key: 'level',
          header: 'Level',
          flex: 1,
          render: (group) => (
            <View style={styles.cellStack}>
              <Chip label={ERROR_LEVEL_LABELS[group.level]} variant={toneVariant(ERROR_LEVEL_TONES[group.level])} testID={`${rowTestID(group)}-level`} />
              <Chip label={ERROR_SOURCE_LABELS[group.source]} variant="neutral" />
              {group.status === 'resolved' ? <Chip label={ERROR_STATUS_LABELS.resolved} variant="success" testID={`${rowTestID(group)}-resolved`} /> : null}
            </View>
          ),
        },
        { key: 'message', header: 'Message', flex: 2.6, render: (group) => <CellText numberOfLines={3}>{group.message}</CellText> },
        {
          key: 'seen',
          header: 'Seen',
          flex: 1.2,
          render: (group) => (
            <View style={styles.cellStack}>
              <CellText>
                {group.occurrences.toLocaleString('en-US')} {group.occurrences === 1 ? 'time' : 'times'}
              </CellText>
              <CellText variant="muted">last {(formatRelativeTime(group.last_seen_at) ?? '').toLowerCase()}</CellText>
            </View>
          ),
        },
        { key: 'where', header: 'Where', flex: 1.4, render: (group) => <CellText variant="muted" numberOfLines={2}>{latestLine(group) || '—'}</CellText> },
      ],
      onRowPress: open,
      rowAccessibilityLabel: (group) =>
        `${ERROR_LEVEL_LABELS[group.level]}, ${ERROR_SOURCE_LABELS[group.source]}: ${group.message}. ${group.occurrences} times, last ${formatRelativeTime(group.last_seen_at) ?? ''}`,
      rowAccessibilityHint: 'Opens the error',
      rowTestID,
    }),
    [],
  );
}

/**
 * The Error log (Hardening & Pilot §E, `system.manage`): app and server error
 * groups, newest first, on the band, with the summary (open, open fatal, last
 * 24 h) as neutral stat cards and the filters for status, source, level, time
 * and message search in a white card; the table in landscape and the cards in
 * portrait (MASTER §6). Every list state and the "Showing n" footer.
 */
export function ErrorLogScreen() {
  const screen = useErrorLogScreen();
  const { screenPaddingX, contentMaxWidth, gutter } = useResponsive();
  const table = useErrorTable();

  const empty: GridEmptyProps = screen.filtersActive
    ? { title: 'No matching errors', message: 'Try another filter or search.', icon: 'search-outline', actionLabel: 'Clear filters', onAction: screen.clearFilters }
    : { title: 'No open errors', message: 'Errors from the tablets, web terminals and the server show here.', icon: 'checkmark-done-outline' };

  return (
    <Screen edges={[]} testID="error-log-screen">
      <ListHeader band title="Error log" subtitle="App and server errors" testIDPrefix="error-log" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        {screen.summary ? (
          <View style={[styles.summary, { paddingHorizontal: screenPaddingX, maxWidth: contentMaxWidth, gap: gutter }]} testID="error-log-summary">
            <StatCard label="Open" value={screen.summary.open.toLocaleString('en-US')} icon="alert-circle-outline" valueTestID="error-log-summary-open" />
            <StatCard label="Open fatal" value={screen.summary.open_fatal.toLocaleString('en-US')} icon="flame-outline" valueTestID="error-log-summary-fatal" />
            <StatCard label="Last 24 h" value={screen.summary.last_24h.toLocaleString('en-US')} icon="time-outline" valueTestID="error-log-summary-24h" />
          </View>
        ) : null}
        <ListToolbar testID="error-log-toolbar">
        <ListFilters<ErrorGroupStatus>
          search={screen.search}
          onSearchChange={screen.setSearch}
          searching={screen.searching}
          placeholder="Search messages"
          searchTestID="error-log-search"
          segment={{ options: STATUSES, value: screen.status, onChange: screen.setStatus, accessibilityLabel: 'Status', testID: 'error-log-status' }}
        />
        <ChipFilterRow<SourceFilter> options={SOURCES} value={screen.source} onChange={screen.setSource} accessibilityLabel="Source" testIDPrefix="error-log-source" />
        <ChipFilterRow<LevelFilter> options={LEVELS} value={screen.level} onChange={screen.setLevel} accessibilityLabel="Level" testIDPrefix="error-log-level" />
        <ChipFilterRow<RangeFilter> options={RANGES} value={screen.range} onChange={screen.setRange} accessibilityLabel="Last seen" testIDPrefix="error-log-range" />
        </ListToolbar>
        <CardGrid
          items={screen.list.items}
          keyOf={keyOf}
          renderItem={(group) => <ErrorGroupCard group={group} onPress={open} />}
          {...screen.list.grid}
          empty={empty}
          table={table}
          testID="error-log-grid"
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  summary: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    paddingBottom: spacing.md,
  },
  cellStack: {
    gap: spacing.xs,
    alignItems: 'flex-start',
    maxWidth: '100%',
  },
});
