import { memo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { DateField } from '@/components/shared/DateField';
import { ReservationActionDialogs } from '@/components/tables/ReservationDialogs';
import { ReservationFormDialog } from '@/components/tables/ReservationFormDialog';
import { guestsLabel, RESERVATION_STATUS_LABELS, RESERVATIONS_DINE_IN_OFF, tableLabel, TABLES_OFFLINE_MESSAGE } from '@/components/tables/tableLabels';
import { ActionMenu, type MenuAction } from '@/components/ui/ActionMenu';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip, type ChipVariant } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, iconSizes, layout, numeric, opacity, pressedScale, radius, sizes, spacing, typography } from '@/constants/theme';
import { targetOfReservation } from '@/hooks/tables/useReservationActions';
import { useBranchTime } from '@/hooks/tables/useBranchTime';
import type { ReservationsState } from '@/hooks/tables/useReservations';
import { useNow } from '@/hooks/useNow';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { Reservation, ReservationStatus } from '@/services/types';

/** The No-show action appears once the time has come; checked this often. */
const CLOCK_MS = 15_000;

const STATUS_CHIPS: Record<ReservationStatus, ChipVariant> = {
  booked: 'info',
  seated: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
};

type RowProps = { reservation: Reservation; time: (iso: string) => string; busy: boolean; onPress: (reservation: Reservation) => void };

const ReservationRow = memo(function ReservationRow({ reservation, time, busy, onPress }: RowProps) {
  const status = RESERVATION_STATUS_LABELS[reservation.status];
  const booked = reservation.status === 'booked';
  const late = booked && reservation.is_late;
  const detail = `${guestsLabel(reservation.party_size)} · ${tableLabel(reservation.table.name)}${reservation.phone ? ` · ${reservation.phone}` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${time(reservation.reserved_for)}, ${reservation.guest_name}, ${detail}, ${status}${late ? ', late' : ''}`}
      accessibilityHint={booked ? 'Shows the actions' : undefined}
      accessibilityState={{ disabled: busy || !booked }}
      disabled={busy || !booked}
      onPress={() => onPress(reservation)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`reservation-row-${reservation.ulid}`}
    >
      <Text style={styles.time}>{time(reservation.reserved_for)}</Text>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {reservation.guest_name}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {detail}
        </Text>
        {reservation.notes ? (
          <Text style={styles.meta} numberOfLines={2}>
            {reservation.notes}
          </Text>
        ) : null}
      </View>
      <View style={styles.chips}>
        <Chip label={status} variant={STATUS_CHIPS[reservation.status]} size="sm" />
        {late ? <Chip label="Late" variant="warning" size="sm" testID={`reservation-row-${reservation.ulid}-late`} /> : null}
      </View>
      {booked ? <Icon name="ellipsis-vertical" size={iconSizes.md} color={colors.textSecondary} /> : null}
    </Pressable>
  );
});

/**
 * Tables → **Reservations** (Table Management §E and §F; `sale.create`):
 * a business-day picker with the day's reservations by time (status chips,
 * **Late** in amber), **New reservation**, and per row **Edit**, **Seat
 * now** (today only), **Cancel** and **No-show**. Online only; while dine-in
 * is off: `Turn on dine-in in Settings to take reservations.`
 */
export function ReservationsPanel({ state, dineIn }: { state: ReservationsState; dineIn: boolean }) {
  const { screenPaddingX, screenPaddingY, isPhone } = useResponsive();
  const { time } = useBranchTime();
  const [menuFor, setMenuFor] = useState<Reservation | null>(null);
  const now = useNow(CLOCK_MS);
  const { actions, list } = state;

  if (!dineIn || state.dineInOff) {
    return <EmptyState title="Dine-in is off" message={RESERVATIONS_DINE_IN_OFF} icon="toggle-outline" testID="reservations-dine-in-off" />;
  }
  if (!state.online) {
    return <EmptyState title={TABLES_OFFLINE_MESSAGE} message="Reservations are kept on the server." icon="cloud-offline-outline" testID="reservations-offline" />;
  }

  const menuActions: MenuAction[] = [];
  if (menuFor && menuFor.status === 'booked') {
    const target = targetOfReservation(menuFor);
    menuActions.push({ key: 'edit', label: 'Edit', icon: 'create-outline', onPress: () => state.openEdit(menuFor) });
    if (menuFor.business_date === state.today) {
      menuActions.push({ key: 'seat', label: 'Seat now', icon: 'restaurant-outline', onPress: () => actions.seat(target) });
    }
    menuActions.push({ key: 'cancel', label: 'Cancel reservation', icon: 'close-circle-outline', destructive: true, onPress: () => actions.ask('cancel', target) });
    if (Date.parse(menuFor.reserved_for) <= now) {
      menuActions.push({ key: 'no_show', label: 'No-show', icon: 'person-remove-outline', destructive: true, onPress: () => actions.ask('no_show', target) });
    }
  }

  const refresh = <RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />;
  const toolbar = (
    <View style={[styles.toolbar, isPhone && styles.toolbarStacked]}>
      <View style={styles.date}>
        <DateField label="Day" value={state.date} onChange={state.setDate} testID="reservations-date" />
      </View>
      <Button title="New reservation" leftIcon="add" onPress={state.openNew} testID="reservations-new" />
    </View>
  );

  let empty;
  if (list.isPending) empty = <LoadingState variant="list" message="Loading reservations…" testID="reservations-loading" />;
  else if (list.error) {
    empty = <ErrorState title="Couldn't load the reservations" message={getErrorMessage(list.error)} onRetry={() => void list.refetch()} testID="reservations-error" />;
  } else {
    empty = (
      <EmptyState
        title="No reservations"
        message={state.date === state.today ? 'Nothing is booked for today yet.' : 'Nothing is booked for this day.'}
        icon="calendar-outline"
        actionLabel="New reservation"
        onAction={state.openNew}
        testID="reservations-empty"
      />
    );
  }

  return (
    <>
      <FlatList
        data={state.rows}
        keyExtractor={(reservation) => reservation.ulid}
        renderItem={({ item }) => <ReservationRow reservation={item} time={time} busy={actions.seatingUlid !== null} onPress={setMenuFor} />}
        ListHeaderComponent={
          <View style={styles.header}>
            {toolbar}
            {actions.seatError ? <Banner message={actions.seatError} testID="reservations-seat-error" /> : null}
            {list.error && state.rows.length > 0 ? <Banner message={getErrorMessage(list.error)} testID="reservations-refresh-error" /> : null}
          </View>
        }
        ListEmptyComponent={empty}
        extraData={time}
        refreshControl={refresh}
        contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingBottom: screenPaddingY, maxWidth: layout.formWideMaxWidth }]}
        testID="reservations-list"
      />
      <ActionMenu
        title={menuFor ? `${menuFor.guest_name} · ${time(menuFor.reserved_for)}` : null}
        actions={menuActions}
        onClose={() => setMenuFor(null)}
        testID="reservation-actions"
      />
      <ReservationFormDialog state={state} />
      <ReservationActionDialogs actions={actions} time={time} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  header: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  toolbarStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  date: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.listRow,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
    transform: [{ scale: pressedScale }],
    opacity: opacity.pressed,
  },
  time: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
    width: layout.reservationTimeWidth,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  meta: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  chips: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
});
