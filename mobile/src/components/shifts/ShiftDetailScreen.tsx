import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SectionLabel } from '@/components/shared/FormSection';
import { DetailRow, InfoCard } from '@/components/shared/InfoCard';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { shiftFlagLabel } from '@/components/shifts/ShiftCard';
import { ShiftPrintStatus } from '@/components/shifts/ShiftPrintStatus';
import { ShiftReportView } from '@/components/shifts/ShiftReportView';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { TopBar } from '@/components/ui/TopBar';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ROUTES } from '@/constants/routes';
import { colors, layout, spacing } from '@/constants/theme';
import { useShiftDetail } from '@/hooks/shifts/useShifts';
import { useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@/utils/businessDay';
import { formatPeso } from '@/utils/money';
import { goBackOr } from '@/utils/navigation';

function backToShifts() {
  goBackOr(ROUTES.shifts);
}

/**
 * One shift (`report.zread`): the server's `Shift` and its `ShiftReport` (the
 * record of truth), with **Print**: an X-read while the shift is open, the
 * Z-read (marked as a reprint) once it is closed, on this tablet's receipt
 * printer. Scrolls, with pull-to-refresh; a centred column (max 640).
 */
export function ShiftDetailScreen({ ulid }: { ulid: string | null }) {
  const detail = useShiftDetail(ulid);
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? '');
  const { screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const shift = detail.query.data;

  if (!shift) {
    return (
      <RecordLoadState
        title="Shift"
        error={detail.query.isError ? detail.query.error : ulid === null ? new Error('Shift not found.') : null}
        onRetry={() => void detail.query.refetch()}
        onBack={backToShifts}
        testID="shift-detail-state"
      />
    );
  }

  const time = (iso: string | null) => (iso ? (formatBranchDateTime(iso, timeZone) ?? iso) : '—');

  async function refresh() {
    setRefreshing(true);
    try {
      await detail.query.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen edges={[]} testID="shift-detail-screen">
      <TopBar
        title={shift.status === 'open' ? 'Open shift' : 'Closed shift'}
        subtitle={`Tablet ${shift.device.code}`}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={backToShifts} testID="shift-detail-back" />}
        testID="shift-detail-header"
      />
      <SafeAreaView edges={['left', 'right']} style={styles.fill}>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: screenPaddingX,
            paddingTop: screenPaddingY,
            paddingBottom: insets.bottom + screenPaddingY + layout.tabBarHeight,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              colors={[colors.primaryBright]}
              tintColor={colors.primaryBright}
            />
          }
          testID="shift-detail-scroll"
        >
          <View style={[styles.inner, { gap: gutter }]}>
            <InfoCard title="Shift" icon="time-outline" testID="shift-detail-summary">
              <View style={styles.chips}>
                <Chip
                  label={shift.status === 'open' ? 'Open' : 'Closed'}
                  variant={shift.status === 'open' ? 'processing' : 'completed'}
                  testID="shift-detail-status"
                />
                {shift.flags.map((flag) => (
                  <Chip key={flag} label={shiftFlagLabel(flag)} variant="caution" icon="flag-outline" testID={`shift-flag-${flag}`} />
                ))}
              </View>
              <DetailRow label="Opened" value={`${time(shift.opened_at)} · ${shift.opened_by.name}`} testID="shift-detail-opened" />
              <DetailRow label="Starting cash" value={formatPeso(shift.opening_float_cents)} />
              {shift.closed_at ? (
                <DetailRow
                  label="Closed"
                  value={shift.closed_by ? `${time(shift.closed_at)} · ${shift.closed_by.name}` : time(shift.closed_at)}
                  testID="shift-detail-closed"
                />
              ) : null}
              {shift.close_note ? <DetailRow label="Note" value={shift.close_note} testID="shift-detail-note" /> : null}
            </InfoCard>

            <Card style={styles.card} testID="shift-detail-report-card">
              <SectionLabel>{shift.status === 'open' ? 'Report so far' : 'Shift report'}</SectionLabel>
              <ShiftReportView
                report={shift.report}
                openingFloatCents={shift.opening_float_cents}
                countedCashCents={shift.counted_cash_cents}
                testID="shift-detail-report"
              />
            </Card>

            <Card style={styles.card}>
              <Button
                title={shift.status === 'open' ? 'Print X-read' : 'Print Z-read'}
                leftIcon="print-outline"
                onPress={detail.printShift}
                loading={detail.printing}
                testID="shift-detail-print"
              />
              {detail.print ? (
                <ShiftPrintStatus jobIds={detail.print.jobIds} notice={detail.print.notice} testID="shift-detail-print-status" />
              ) : null}
            </Card>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  inner: {
    width: '100%',
    maxWidth: layout.receiptMaxWidth,
    alignSelf: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  card: {
    gap: spacing.md,
  },
});
